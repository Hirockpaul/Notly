import asyncio
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import uuid4

from app.core.config import settings
from app.processing.alignment import SoloTranscriptAligner
from app.processing.models import AlignedTranscript, AudioFrame
from app.processing.pipeline import SpeechSessionPipeline
from app.processing.segmentation import UtteranceSegmenter
from app.providers.fakes import FakeTranscriptionProvider
from app.providers.local_fakes import FakeVoiceActivityDetector
from app.providers.nvidia import NvidiaAsrConfig, NvidiaTranscriptionProvider

MAX_CHUNK_BYTES = 16000 * 2 * 2  # at most two seconds of mono PCM16
MAX_COMPLETED_SESSIONS = 100


class SessionNotFoundError(LookupError):
    pass


class SessionStateError(RuntimeError):
    pass


class SequenceError(ValueError):
    pass


class PipelineProcessingError(RuntimeError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("Speech processing failed.")
        self.errors = errors


@dataclass(slots=True)
class SpeechSession:
    session_id: str
    pipeline: SpeechSessionPipeline
    next_sequence: int = 0
    status: str = "recording"
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


def create_fake_pipeline(session_id: str) -> SpeechSessionPipeline:
    del session_id
    return SpeechSessionPipeline(
        diarization=None,
        transcription=FakeTranscriptionProvider(text="Speech detected by the local test provider."),
        segmenter=UtteranceSegmenter(FakeVoiceActivityDetector()),
        aligner=SoloTranscriptAligner(),
    )


def create_solo_pipeline(session_id: str) -> SpeechSessionPipeline:
    if settings.transcription_provider == "fake":
        return create_fake_pipeline(session_id)
    transcription = NvidiaTranscriptionProvider(
        NvidiaAsrConfig(
            api_key=settings.nvidia_api_key,
            uri=settings.nvidia_riva_uri,
            function_id=settings.nvidia_asr_function_id,
            model=settings.nvidia_asr_model,
            language_code=settings.nvidia_asr_language_code,
            timeout_seconds=settings.nvidia_asr_timeout_seconds,
            max_retries=settings.nvidia_asr_max_retries,
        )
    )
    return SpeechSessionPipeline(
        diarization=None,
        transcription=transcription,
        segmenter=UtteranceSegmenter(FakeVoiceActivityDetector()),
        aligner=SoloTranscriptAligner(),
        provider_timeout_seconds=(settings.nvidia_asr_timeout_seconds + 1)
        * (settings.nvidia_asr_max_retries + 1),
    )


class SpeechSessionManager:
    def __init__(
        self,
        pipeline_factory: Callable[[str], SpeechSessionPipeline] = create_solo_pipeline,
        max_completed_sessions: int = MAX_COMPLETED_SESSIONS,
    ) -> None:
        self._pipeline_factory = pipeline_factory
        self._max_completed_sessions = max_completed_sessions
        self._sessions: dict[str, SpeechSession] = {}
        self._completed: OrderedDict[str, AlignedTranscript] = OrderedDict()

    @property
    def active_session_count(self) -> int:
        return len(self._sessions)

    async def start(self) -> SpeechSession:
        session_id = str(uuid4())
        pipeline = self._pipeline_factory(session_id)
        session = SpeechSession(session_id=session_id, pipeline=pipeline)
        await pipeline.start(session_id)
        self._sessions[session_id] = session
        return session

    async def push(
        self,
        session_id: str,
        sequence: int,
        payload: bytes,
        sample_rate: int,
        channel_count: int,
    ) -> SpeechSession:
        session = self._sessions.get(session_id)
        if session is None:
            if session_id in self._completed:
                raise SessionStateError("Session is already completed.")
            raise SessionNotFoundError("Unknown speech session.")
        async with session.lock:
            if session.status != "recording":
                raise SessionStateError("Session is not accepting audio.")
            if sequence != session.next_sequence:
                raise SequenceError(
                    f"Expected audio sequence {session.next_sequence}, received {sequence}."
                )
            await session.pipeline.push(
                AudioFrame(
                    session_id=session_id,
                    sequence=sequence,
                    pcm16=payload,
                    sample_rate=sample_rate,
                    channel_count=channel_count,
                )
            )
            session.next_sequence += 1
            return session

    async def finish(self, session_id: str) -> AlignedTranscript:
        completed = self._completed.get(session_id)
        if completed is not None:
            return completed
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError("Unknown speech session.")
        async with session.lock:
            completed = self._completed.get(session_id)
            if completed is not None:
                return completed
            session.status = "processing"
            try:
                result = await session.pipeline.finish(session_id)
            except Exception:
                await session.pipeline.cancel(session_id)
                self._sessions.pop(session_id, None)
                raise
            self._sessions.pop(session_id, None)
            if result.errors:
                raise PipelineProcessingError(result.errors)
            self._completed[session_id] = result.transcript
            while len(self._completed) > self._max_completed_sessions:
                self._completed.popitem(last=False)
            return result.transcript


speech_session_manager = SpeechSessionManager()
