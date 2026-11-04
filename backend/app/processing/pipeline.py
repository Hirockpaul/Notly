import asyncio
from dataclasses import dataclass, field

from app.processing.alignment import TimestampTranscriptAligner
from app.processing.models import (
    AlignedTranscript,
    AudioFrame,
    DiarizationSegment,
    TranscriptionResult,
    Utterance,
)
from app.processing.segmentation import UtteranceSegmenter
from app.providers.interfaces import (
    DiarizationProvider,
    ProviderTimeoutError,
    TranscriptionProvider,
    with_provider_timeout,
)


@dataclass(slots=True)
class PipelineError:
    utterance_id: str
    message: str


@dataclass(slots=True)
class PipelineResult:
    transcript: AlignedTranscript
    errors: list[PipelineError] = field(default_factory=list)
    pending_utterances: int = 0


class SpeechSessionPipeline:
    """Coordinates independent diarization and utterance-transcription branches.

    This foundation is deliberately not connected to the ingestion endpoint until
    real providers and lifecycle semantics are selected.
    """

    def __init__(
        self,
        diarization: DiarizationProvider | None,
        transcription: TranscriptionProvider,
        segmenter: UtteranceSegmenter,
        aligner: TimestampTranscriptAligner | None = None,
        provider_timeout_seconds: float = 10.0,
        max_concurrent_transcriptions: int = 2,
        max_pending_transcriptions: int = 8,
    ) -> None:
        self._diarization = diarization
        self._transcription = transcription
        self._segmenter = segmenter
        self._aligner = aligner or TimestampTranscriptAligner()
        self._timeout = provider_timeout_seconds
        self._max_pending_transcriptions = max_pending_transcriptions
        self._transcription_tasks: dict[str, list[asyncio.Task[None]]] = {}
        self._transcriptions: dict[str, dict[str, TranscriptionResult]] = {}
        self._seen_utterances: dict[str, set[str]] = {}
        self._diarization_segments: dict[str, list[DiarizationSegment]] = {}
        self._errors: dict[str, list[PipelineError]] = {}
        self._transcription_slots = asyncio.Semaphore(max_concurrent_transcriptions)

    async def start(self, session_id: str) -> None:
        if session_id in self._transcription_tasks:
            raise ValueError("Pipeline session is already active.")
        self._transcription_tasks[session_id] = []
        self._transcriptions[session_id] = {}
        self._seen_utterances[session_id] = set()
        self._diarization_segments[session_id] = []
        self._errors[session_id] = []
        if self._diarization is not None:
            await with_provider_timeout(self._diarization.start_session(session_id), self._timeout)

    async def push(self, frame: AudioFrame) -> None:
        if frame.session_id not in self._transcription_tasks:
            raise ValueError("Pipeline session is not active.")

        if self._diarization is not None:
            try:
                segments = await with_provider_timeout(
                    self._diarization.push_audio(frame), self._timeout
                )
                self._diarization_segments[frame.session_id].extend(segments)
            except (ProviderTimeoutError, RuntimeError) as error:
                self._errors[frame.session_id].append(
                    PipelineError(utterance_id="diarization", message=str(error))
                )

        for utterance in self._segmenter.push(frame):
            self._queue_transcription(utterance)

    async def finish(self, session_id: str) -> PipelineResult:
        if session_id not in self._transcription_tasks:
            raise ValueError("Pipeline session is not active.")

        for utterance in self._segmenter.flush(session_id):
            self._queue_transcription(utterance)

        if self._diarization is not None:
            try:
                segments = await with_provider_timeout(
                    self._diarization.finish_session(session_id), self._timeout
                )
                self._diarization_segments[session_id].extend(segments)
            except (ProviderTimeoutError, RuntimeError) as error:
                self._errors[session_id].append(
                    PipelineError(utterance_id="diarization", message=str(error))
                )

        await asyncio.gather(*self._transcription_tasks[session_id])

        result = self.progress(session_id)
        if self._diarization is not None:
            await self._diarization.close_session(session_id)
        self._transcription_tasks.pop(session_id, None)
        self._transcriptions.pop(session_id, None)
        self._seen_utterances.pop(session_id, None)
        self._diarization_segments.pop(session_id, None)
        self._errors.pop(session_id, None)
        return result

    async def cancel(self, session_id: str) -> None:
        """Release all session resources without producing a transcript."""
        tasks = self._transcription_tasks.pop(session_id, [])
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._diarization_segments.pop(session_id, None)
        self._transcriptions.pop(session_id, None)
        self._seen_utterances.pop(session_id, None)
        self._errors.pop(session_id, None)
        self._segmenter.close(session_id)
        if self._diarization is not None:
            await self._diarization.close_session(session_id)

    def _queue_transcription(self, utterance: Utterance) -> None:
        seen = self._seen_utterances[utterance.session_id]
        if utterance.utterance_id in seen:
            return
        seen.add(utterance.utterance_id)
        tasks = self._transcription_tasks[utterance.session_id]
        if sum(not task.done() for task in tasks) >= self._max_pending_transcriptions:
            self._errors[utterance.session_id].append(
                PipelineError(
                    utterance_id=utterance.utterance_id,
                    message="Transcription capacity was exceeded for this session.",
                )
            )
            return
        task = asyncio.create_task(self._transcribe_and_record(utterance))
        tasks.append(task)

    async def _transcribe_and_record(self, utterance: Utterance) -> None:
        try:
            async with self._transcription_slots:
                result = await with_provider_timeout(
                    self._transcription.transcribe(utterance), self._timeout
                )
            if (
                result.session_id != utterance.session_id
                or result.utterance_id != utterance.utterance_id
            ):
                raise RuntimeError("Transcription provider returned mismatched utterance metadata.")
            self._transcriptions[utterance.session_id][utterance.utterance_id] = result
        except (ProviderTimeoutError, RuntimeError) as error:
            self._errors[utterance.session_id].append(
                PipelineError(utterance_id=utterance.utterance_id, message=str(error))
            )

    def progress(self, session_id: str) -> PipelineResult:
        if session_id not in self._transcription_tasks:
            raise ValueError("Pipeline session is not active.")
        tasks = self._transcription_tasks[session_id]
        return PipelineResult(
            transcript=self._aligner.align(
                session_id,
                list(self._transcriptions[session_id].values()),
                self._diarization_segments[session_id],
            ),
            errors=list(self._errors[session_id]),
            pending_utterances=sum(not task.done() for task in tasks),
        )
