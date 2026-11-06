import asyncio
import json
import urllib.error

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.notes.models import NotesDocument
from app.notes.providers import (
    FakeNotesProvider,
    NotesAuthenticationError,
    NotesInvalidResponseError,
    NotesTimeoutError,
    OpenAICompatibleNotesConfig,
    OpenAICompatibleNotesProvider,
    chat_completions_url,
)
from app.processing.models import AlignedTranscript, AlignedTranscriptSegment
from app.services.notes import EmptyTranscriptError, NotesService


def test_normalizes_openai_compatible_base_url() -> None:
    assert (
        chat_completions_url("https://api.groq.com/openai/v1")
        == "https://api.groq.com/openai/v1/chat/completions"
    )
    assert (
        chat_completions_url("https://notes.example/v1/chat/completions")
        == "https://notes.example/v1/chat/completions"
    )


def transcript(text: str = "Ship the release on Friday.") -> AlignedTranscript:
    return AlignedTranscript(
        session_id="session",
        segments=[
            AlignedTranscriptSegment(
                utterance_id="utterance-0001",
                speaker="You",
                text=text,
                start=2.0,
                end=3.5,
            )
        ],
    )


class StubTransport:
    def __init__(self, outcome: object) -> None:
        self.outcome = outcome
        self.request_body: dict[str, object] | None = None

    def post(self, url: str, headers: dict[str, str], body: bytes, timeout: float) -> object:
        assert url == "https://notes.example/v1/chat/completions"
        assert headers["Authorization"] == "Bearer secret"
        assert timeout == 1
        self.request_body = json.loads(body)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def hosted_provider(outcome: object) -> tuple[OpenAICompatibleNotesProvider, StubTransport]:
    transport = StubTransport(outcome)
    provider = OpenAICompatibleNotesProvider(
        OpenAICompatibleNotesConfig(
            api_url="https://notes.example/v1/chat/completions",
            api_key="secret",
            model="notes-model",
            timeout_seconds=1,
        ),
        transport,
    )
    return provider, transport


@pytest.mark.asyncio
async def test_fake_provider_is_grounded_in_transcript() -> None:
    result = await FakeNotesProvider().generate(transcript())
    assert result.summary == "Ship the release on Friday."
    assert result.key_points == ["Ship the release on Friday."]


@pytest.mark.asyncio
async def test_openai_compatible_provider_requests_and_validates_structured_json() -> None:
    content = json.dumps(
        {
            "title": "Release plan",
            "summary": "The release is planned for Friday.",
            "keyPoints": ["Release on Friday."],
            "actionItems": [{"task": "Ship the release", "owner": None, "deadline": "Friday"}],
            "importantInformation": ["Friday"],
            "decisions": [],
            "additionalContext": [],
        }
    )
    provider, transport = hosted_provider({"choices": [{"message": {"content": content}}]})

    result = await provider.generate(transcript())

    assert result.title == "Release plan"
    assert result.action_items[0].owner is None
    assert transport.request_body is not None
    assert transport.request_body["model"] == "notes-model"
    messages = transport.request_body["messages"]
    assert "[2.00-3.50] You: Ship the release on Friday." in messages[1]["content"]


@pytest.mark.asyncio
async def test_hosted_provider_rejects_malformed_output() -> None:
    provider, _ = hosted_provider({"choices": [{"message": {"content": "not json"}}]})
    with pytest.raises(NotesInvalidResponseError):
        await provider.generate(transcript())


@pytest.mark.asyncio
async def test_hosted_provider_reports_timeout_and_authentication_safely() -> None:
    timeout_provider, _ = hosted_provider(TimeoutError())
    with pytest.raises(NotesTimeoutError, match="did not respond"):
        await timeout_provider.generate(transcript())

    auth_error = urllib.error.HTTPError("url", 401, "denied", {}, None)
    auth_provider, _ = hosted_provider(auth_error)
    with pytest.raises(NotesAuthenticationError, match="credentials"):
        await auth_provider.generate(transcript())


def test_structured_notes_require_useful_content() -> None:
    with pytest.raises(ValidationError, match="useful sections"):
        NotesDocument(title="Empty")


class CountingProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def generate(self, value: AlignedTranscript) -> NotesDocument:
        del value
        self.calls += 1
        await asyncio.sleep(0.01)
        return NotesDocument(title=f"Generation {self.calls}", summary="Grounded summary")


@pytest.mark.asyncio
async def test_service_deduplicates_concurrent_generation_and_supports_regeneration() -> None:
    provider = CountingProvider()
    service = NotesService(provider)

    first, second = await asyncio.gather(
        service.generate("session", transcript()),
        service.generate("session", transcript()),
    )
    cached = await service.generate("session", transcript())
    regenerated = await service.generate("session", transcript(), regenerate=True)

    assert first == second == cached
    assert provider.calls == 2
    assert regenerated.title == "Generation 2"


@pytest.mark.asyncio
async def test_service_rejects_empty_transcript() -> None:
    service = NotesService(FakeNotesProvider())
    empty = AlignedTranscript(session_id="session", segments=[])
    with pytest.raises(EmptyTranscriptError):
        await service.generate("session", empty)


def test_hosted_notes_configuration_requires_all_credentials() -> None:
    with pytest.raises(
        ValidationError,
        match="NOTO_NOTES_API_URL, NOTO_NOTES_API_KEY, NOTO_NOTES_MODEL",
    ):
        Settings(notes_provider="openai_compatible")
