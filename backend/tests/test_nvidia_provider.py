from types import SimpleNamespace

import grpc
import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.processing.models import Utterance
from app.providers.nvidia import (
    NvidiaAsrConfig,
    NvidiaAsrError,
    NvidiaAuthenticationError,
    NvidiaInvalidResponseError,
    NvidiaRateLimitError,
    NvidiaTranscriptionProvider,
)


class FakeRpcError(grpc.RpcError):
    def __init__(self, status: grpc.StatusCode) -> None:
        self._status = status

    def code(self) -> grpc.StatusCode:
        return self._status


class StubClient:
    def __init__(self, outcomes: list[object]) -> None:
        self.outcomes = outcomes
        self.calls = 0

    def recognize(self, pcm16: bytes, timeout_seconds: float) -> object:
        assert pcm16
        assert timeout_seconds == 1
        outcome = self.outcomes[self.calls]
        self.calls += 1
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def response(text: str) -> object:
    alternative = SimpleNamespace(transcript=text)
    return SimpleNamespace(results=[SimpleNamespace(alternatives=[alternative])])


def utterance() -> Utterance:
    return Utterance(
        session_id="session",
        utterance_id="utterance-0001",
        pcm16=b"\x01\x00" * 1600,
        start=1.25,
        end=1.35,
    )


def provider(client: StubClient, retries: int = 2) -> NvidiaTranscriptionProvider:
    config = NvidiaAsrConfig(
        api_key="secret",
        uri="grpc.nvcf.nvidia.com:443",
        function_id="function-id",
        model="canary-1b-asr",
        language_code="en-US",
        timeout_seconds=1,
        max_retries=retries,
    )
    return NvidiaTranscriptionProvider(config, client_factory=lambda _: client)


@pytest.mark.asyncio
async def test_successful_transcription_preserves_utterance_timestamps() -> None:
    result = await provider(StubClient([response("Hello from Canary.")])).transcribe(utterance())
    assert result.text == "Hello from Canary."
    assert (result.start, result.end) == (1.25, 1.35)
    assert result.words == []


@pytest.mark.asyncio
async def test_empty_transcription_is_valid_and_not_fabricated() -> None:
    result = await provider(StubClient([response("  ")])).transcribe(utterance())
    assert result.text == ""


@pytest.mark.asyncio
async def test_authentication_failure_is_not_retried() -> None:
    client = StubClient([FakeRpcError(grpc.StatusCode.UNAUTHENTICATED)])
    with pytest.raises(NvidiaAuthenticationError):
        await provider(client).transcribe(utterance())
    assert client.calls == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "expected_error"),
    [
        (grpc.StatusCode.DEADLINE_EXCEEDED, NvidiaAsrError),
        (grpc.StatusCode.RESOURCE_EXHAUSTED, NvidiaRateLimitError),
    ],
)
async def test_timeout_and_rate_limit_are_reported(
    status: grpc.StatusCode, expected_error: type[Exception]
) -> None:
    client = StubClient([FakeRpcError(status)])
    with pytest.raises(expected_error):
        await provider(client, retries=0).transcribe(utterance())


@pytest.mark.asyncio
async def test_transient_network_failure_is_retried_without_duplicate_result() -> None:
    client = StubClient([FakeRpcError(grpc.StatusCode.UNAVAILABLE), response("Recovered.")])
    result = await provider(client, retries=1).transcribe(utterance())
    assert result.text == "Recovered."
    assert client.calls == 2


@pytest.mark.asyncio
async def test_invalid_response_is_rejected() -> None:
    with pytest.raises(NvidiaInvalidResponseError):
        await provider(StubClient([object()])).transcribe(utterance())


def test_missing_nvidia_configuration_is_actionable() -> None:
    with pytest.raises(ValidationError, match="NVIDIA_API_KEY, NVIDIA_ASR_FUNCTION_ID"):
        Settings(transcription_provider="nvidia")
