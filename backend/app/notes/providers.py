import asyncio
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from pydantic import ValidationError

from app.notes.models import NotesDocument
from app.processing.models import AlignedTranscript


class NotesProviderError(RuntimeError):
    """Safe notes-provider error that never includes credentials or prompt content."""


class NotesAuthenticationError(NotesProviderError):
    pass


class NotesTimeoutError(NotesProviderError):
    pass


class NotesInvalidResponseError(NotesProviderError):
    pass


class NotesProvider(Protocol):
    async def generate(self, transcript: AlignedTranscript) -> NotesDocument: ...


class FakeNotesProvider:
    async def generate(self, transcript: AlignedTranscript) -> NotesDocument:
        statements = [
            segment.text.strip() for segment in transcript.segments if segment.text.strip()
        ]
        return NotesDocument(
            title="Recording notes",
            summary=" ".join(statements),
            keyPoints=statements,
        )


@dataclass(frozen=True, slots=True)
class OpenAICompatibleNotesConfig:
    api_url: str
    api_key: str
    model: str
    timeout_seconds: float


class JsonHttpTransport(Protocol):
    def post(self, url: str, headers: dict[str, str], body: bytes, timeout: float) -> object: ...


class UrllibJsonTransport:
    def post(self, url: str, headers: dict[str, str], body: bytes, timeout: float) -> object:
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())


class OpenAICompatibleNotesProvider:
    def __init__(
        self,
        config: OpenAICompatibleNotesConfig,
        transport: JsonHttpTransport | None = None,
    ) -> None:
        self._config = config
        self._transport = transport or UrllibJsonTransport()

    async def generate(self, transcript: AlignedTranscript) -> NotesDocument:
        payload = {
            "model": self._config.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": format_transcript(transcript)},
            ],
        }
        try:
            response = await asyncio.to_thread(
                self._transport.post,
                chat_completions_url(self._config.api_url),
                {
                    "Authorization": f"Bearer {self._config.api_key}",
                    "Content-Type": "application/json",
                    "User-Agent": "Noto-AI/0.1",
                },
                json.dumps(payload).encode(),
                self._config.timeout_seconds,
            )
        except urllib.error.HTTPError as error:
            if error.code in {401, 403}:
                raise NotesAuthenticationError(
                    "The notes provider rejected the configured credentials."
                ) from error
            raise NotesProviderError("The hosted notes provider rejected the request.") from error
        except (TimeoutError, urllib.error.URLError) as error:
            if isinstance(error, urllib.error.URLError) and not isinstance(
                error.reason, TimeoutError
            ):
                raise NotesProviderError("The hosted notes provider is unavailable.") from error
            raise NotesTimeoutError("The notes provider did not respond in time.") from error

        try:
            content = response["choices"][0]["message"]["content"]
            raw_notes = json.loads(content)
            return NotesDocument.model_validate(raw_notes)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as error:
            raise NotesInvalidResponseError(
                "The notes provider returned invalid structured output."
            ) from error


def chat_completions_url(api_url: str) -> str:
    normalized = api_url.rstrip("/")
    if normalized.endswith("/v1"):
        return normalized + "/chat/completions"
    return normalized


def format_transcript(transcript: AlignedTranscript) -> str:
    lines = [
        f"[{segment.start:.2f}-{segment.end:.2f}] {segment.speaker}: {segment.text}"
        for segment in transcript.segments
        if segment.text.strip()
    ]
    return "TRANSCRIPT (the only source of truth):\n" + "\n".join(lines)


SYSTEM_PROMPT = """Create concise structured notes using only the supplied transcript.
Never invent, infer, or externally correct names, owners, dates, numbers, deadlines, decisions,
or facts.
Suggestions are not decisions. If wording is unclear, preserve that uncertainty.
Return one JSON object with exactly these fields: title (string), summary (string or null),
keyPoints (string array), actionItems (array of {task, owner, deadline}, with unknown values null),
importantInformation (string array), decisions (string array), additionalContext (string array).
Use empty arrays or null only when a section has no transcript-grounded content."""
