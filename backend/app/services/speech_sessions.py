import asyncio
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from uuid import uuid4

from app.core.config import settings
from app.processing.alignment import SoloTranscriptAligner
from app.processing.models import AudioFrame
from app.processing.pipeline import PipelineResult, SpeechSessionPipeline
from app.processing.segmentation import UtteranceSegmenter
from app.providers.fakes import FakeTranscriptionProvider
from app.providers.local_fakes import FakeVoiceActivityDetector
from app.providers.nvidia import NvidiaAsrConfig, NvidiaTranscriptionProvider

MAX_CHUNK_BYTES = 16000 * 2 * 2  # at most two seconds of mono PCM16
MAX_COMPLETED_SESSIONS = 100
SESSION_IDLE_TIMEOUT_SECONDS = 300.0


class SessionNotFoundError(LookupError):
    pass


class SessionStateError(RuntimeError):
    pass


class SequenceError(ValueError):
    pass


@dataclass(slots=True)
class SpeechSession:
    session_id: str
    pipeline: SpeechSessionPipeline
    next_sequence: int = 0
    status: str = "recording"
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    cleanup_task: asyncio.Task[None] | None = None


@dataclass(slots=True)
class SpeechSessionSnapshot:
    session_id: str
    status: str
    result: PipelineResult


def create_fake_pipeline(session_id: str, language_code: str = "en-US") -> SpeechSessionPipeline:
    del session_id
    del language_code
    return SpeechSessionPipeline(
        diarization=None,
        transcription=FakeTranscriptionProvider(text="Speech detected by the local test provider."),
        segmenter=UtteranceSegmenter(FakeVoiceActivityDetector()),
        aligner=SoloTranscriptAligner(),
    )


def create_solo_pipeline(session_id: str, language_code: str = "en-US") -> SpeechSessionPipeline:
    if settings.transcription_provider == "fake":
        return create_fake_pipeline(session_id, language_code)
    transcription = NvidiaTranscriptionProvider(
        NvidiaAsrConfig(
            api_key=settings.nvidia_api_key,
            uri=settings.nvidia_riva_uri,
            function_id=settings.nvidia_asr_function_id,
            model=settings.nvidia_asr_model,
            language_code=language_code,
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
        pipeline_factory: Callable[[str, str], SpeechSessionPipeline] = create_solo_pipeline,
        max_completed_sessions: int = MAX_COMPLETED_SESSIONS,
        session_idle_timeout_seconds: float = SESSION_IDLE_TIMEOUT_SECONDS,
    ) -> None:
        self._pipeline_factory = pipeline_factory
        self._max_completed_sessions = max_completed_sessions
        self._session_idle_timeout_seconds = session_idle_timeout_seconds
        self._sessions: dict[str, SpeechSession] = {}
        self._completed: OrderedDict[str, PipelineResult] = OrderedDict()

    @property
    def active_session_count(self) -> int:
        return len(self._sessions)

    async def start(self, language_code: str = "en-US") -> SpeechSession:
        session_id = str(uuid4())
        pipeline = self._pipeline_factory(session_id, language_code)
        session = SpeechSession(session_id=session_id, pipeline=pipeline)
        await pipeline.start(session_id)
        self._sessions[session_id] = session
        self._touch(session)
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
            self._touch(session)
            return session

    async def progress(self, session_id: str) -> SpeechSessionSnapshot:
        completed = self._completed.get(session_id)
        if completed is not None:
            return SpeechSessionSnapshot(
                session_id=session_id,
                status="completed_with_errors" if completed.errors else "completed",
                result=completed,
            )
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError("Unknown speech session.")
        async with session.lock:
            self._touch(session)
            return SpeechSessionSnapshot(
                session_id=session_id,
                status=session.status,
                result=session.pipeline.progress(session_id),
            )

    async def finish(self, session_id: str) -> PipelineResult:
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
            if session.cleanup_task is not None:
                session.cleanup_task.cancel()
                session.cleanup_task = None
            try:
                result = await session.pipeline.finish(session_id)
            except Exception:
                await session.pipeline.cancel(session_id)
                self._sessions.pop(session_id, None)
                raise
            self._sessions.pop(session_id, None)
            self._completed[session_id] = result
            while len(self._completed) > self._max_completed_sessions:
                self._completed.popitem(last=False)
            return result

    def completed_result(self, session_id: str) -> PipelineResult:
        completed = self._completed.get(session_id)
        if completed is not None:
            return completed
        if session_id in self._sessions:
            raise SessionStateError("The speech session must be completed before generating notes.")
        raise SessionNotFoundError("Unknown speech session.")

    def _touch(self, session: SpeechSession) -> None:
        if session.cleanup_task is not None:
            session.cleanup_task.cancel()
        session.cleanup_task = asyncio.create_task(self._expire_idle_session(session.session_id))

    async def _expire_idle_session(self, session_id: str) -> None:
        try:
            await asyncio.sleep(self._session_idle_timeout_seconds)
            session = self._sessions.get(session_id)
            if session is None:
                return
            async with session.lock:
                if self._sessions.get(session_id) is not session or session.status != "recording":
                    return
                await session.pipeline.cancel(session_id)
                self._sessions.pop(session_id, None)
        except asyncio.CancelledError:
            return


speech_session_manager = SpeechSessionManager()
