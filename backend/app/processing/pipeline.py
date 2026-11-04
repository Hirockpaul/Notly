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
class PipelineResult:
    transcript: AlignedTranscript
    errors: list[str] = field(default_factory=list)


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
    ) -> None:
        self._diarization = diarization
        self._transcription = transcription
        self._segmenter = segmenter
        self._aligner = aligner or TimestampTranscriptAligner()
        self._timeout = provider_timeout_seconds
        self._transcription_tasks: dict[str, list[asyncio.Task[TranscriptionResult]]] = {}
        self._diarization_segments: dict[str, list[DiarizationSegment]] = {}
        self._errors: dict[str, list[str]] = {}

    async def start(self, session_id: str) -> None:
        if session_id in self._transcription_tasks:
            raise ValueError("Pipeline session is already active.")
        self._transcription_tasks[session_id] = []
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
                self._errors[frame.session_id].append(f"diarization: {error}")

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
                self._errors[session_id].append(f"diarization: {error}")

        transcriptions: list[TranscriptionResult] = []
        for task in self._transcription_tasks[session_id]:
            try:
                transcriptions.append(await task)
            except (ProviderTimeoutError, RuntimeError) as error:
                self._errors[session_id].append(f"transcription: {error}")

        result = PipelineResult(
            transcript=self._aligner.align(
                session_id,
                transcriptions,
                self._diarization_segments[session_id],
            ),
            errors=list(self._errors[session_id]),
        )
        if self._diarization is not None:
            await self._diarization.close_session(session_id)
        self._transcription_tasks.pop(session_id, None)
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
        self._errors.pop(session_id, None)
        self._segmenter.close(session_id)
        if self._diarization is not None:
            await self._diarization.close_session(session_id)

    def _queue_transcription(self, utterance: Utterance) -> None:
        task = asyncio.create_task(
            with_provider_timeout(self._transcription.transcribe(utterance), self._timeout)
        )
        self._transcription_tasks[utterance.session_id].append(task)
