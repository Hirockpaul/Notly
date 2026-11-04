from collections.abc import Awaitable
from typing import Protocol

from app.processing.models import (
    AlignedTranscript,
    AudioFrame,
    DiarizationSegment,
    TranscriptionResult,
    Utterance,
)


class DiarizationProvider(Protocol):
    async def start_session(self, session_id: str) -> None: ...

    async def push_audio(self, frame: AudioFrame) -> list[DiarizationSegment]: ...

    async def finish_session(self, session_id: str) -> list[DiarizationSegment]: ...

    async def close_session(self, session_id: str) -> None: ...


class TranscriptionProvider(Protocol):
    async def transcribe(self, utterance: Utterance) -> TranscriptionResult: ...


class VoiceActivityDetector(Protocol):
    def score(self, session_id: str, pcm16: bytes, sample_rate: int) -> float: ...

    def reset(self, session_id: str) -> None: ...


class TranscriptAligner(Protocol):
    def align(
        self,
        session_id: str,
        transcriptions: list[TranscriptionResult],
        diarization: list[DiarizationSegment],
    ) -> AlignedTranscript: ...


class ProviderTimeoutError(TimeoutError):
    """Raised when a provider operation exceeds its configured deadline."""


async def with_provider_timeout[T](operation: Awaitable[T], timeout_seconds: float) -> T:
    import asyncio

    try:
        return await asyncio.wait_for(operation, timeout=timeout_seconds)
    except TimeoutError as error:
        raise ProviderTimeoutError("Provider operation timed out.") from error
