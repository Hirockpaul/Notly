import asyncio

import pytest

from app.processing.alignment import SoloTranscriptAligner
from app.processing.models import AudioFrame, DiarizationSegment, TranscriptionResult, Utterance
from app.processing.pipeline import SpeechSessionPipeline
from app.processing.segmentation import SegmentationConfig, UtteranceSegmenter
from app.providers.fakes import (
    FakeDiarizationProvider,
    FakeTranscriptionProvider,
    ScriptedVoiceActivityDetector,
)
from app.providers.interfaces import ProviderTimeoutError, with_provider_timeout


@pytest.mark.asyncio
async def test_pipeline_keeps_branches_independent_and_aligns_results() -> None:
    diarization = FakeDiarizationProvider(
        {
            "session": [
                DiarizationSegment(session_id="session", speaker="Speaker 1", start=0, end=0.1)
            ]
        }
    )
    transcription = FakeTranscriptionProvider()
    pipeline = SpeechSessionPipeline(
        diarization,
        transcription,
        UtteranceSegmenter(ScriptedVoiceActivityDetector({"session": [0.9]})),
    )
    await pipeline.start("session")
    await pipeline.push(AudioFrame(session_id="session", sequence=0, pcm16=b"\x00\x00" * 1600))

    result = await pipeline.finish("session")

    assert result.errors == []
    assert result.transcript.segments[0].speaker == "Speaker 1"
    assert transcription.utterance_ids == ["utterance-0001"]


@pytest.mark.asyncio
async def test_provider_timeout_is_explicit() -> None:
    async def slow_operation() -> None:
        await asyncio.sleep(0.05)

    with pytest.raises(ProviderTimeoutError):
        await with_provider_timeout(slow_operation(), 0.001)


@pytest.mark.asyncio
async def test_solo_pipeline_does_not_invoke_diarization() -> None:
    transcription = FakeTranscriptionProvider("Solo transcript")
    pipeline = SpeechSessionPipeline(
        None,
        transcription,
        UtteranceSegmenter(ScriptedVoiceActivityDetector({"solo": [0.9]})),
        aligner=SoloTranscriptAligner(),
    )
    await pipeline.start("solo")
    await pipeline.push(AudioFrame(session_id="solo", sequence=0, pcm16=b"\x01\x00" * 1600))
    result = await pipeline.finish("solo")
    assert result.errors == []
    assert result.transcript.segments[0].speaker == "You"
    assert result.transcript.segments[0].text == "Solo transcript"


class OutOfOrderTranscriptionProvider:
    async def transcribe(self, utterance: Utterance) -> TranscriptionResult:
        if utterance.utterance_id == "utterance-0001":
            await asyncio.sleep(0.02)
        return TranscriptionResult(
            session_id=utterance.session_id,
            utterance_id=utterance.utterance_id,
            text=utterance.utterance_id,
            start=utterance.start,
            end=utterance.end,
        )


@pytest.mark.asyncio
async def test_multiple_utterances_are_progressive_ordered_and_not_duplicated() -> None:
    pipeline = SpeechSessionPipeline(
        None,
        OutOfOrderTranscriptionProvider(),
        UtteranceSegmenter(
            ScriptedVoiceActivityDetector({"session": [0.9, 0.0, 0.9, 0.0]}),
            SegmentationConfig(end_silence_ms=100, pre_speech_ms=0),
        ),
        aligner=SoloTranscriptAligner(),
    )
    await pipeline.start("session")
    for sequence in range(4):
        await pipeline.push(
            AudioFrame(
                session_id="session",
                sequence=sequence,
                pcm16=b"\x01\x00" * 1600,
            )
        )

    await asyncio.sleep(0.001)
    progressive = pipeline.progress("session")
    assert [segment.utterance_id for segment in progressive.transcript.segments] == [
        "utterance-0002"
    ]
    assert progressive.pending_utterances == 1

    result = await pipeline.finish("session")
    assert [segment.utterance_id for segment in result.transcript.segments] == [
        "utterance-0001",
        "utterance-0002",
    ]
    assert [(segment.start, segment.end) for segment in result.transcript.segments] == [
        (0.0, 0.2),
        (0.2, 0.4),
    ]
    assert result.pending_utterances == 0


class PartiallyFailingTranscriptionProvider:
    async def transcribe(self, utterance: Utterance) -> TranscriptionResult:
        if utterance.utterance_id == "utterance-0001":
            raise RuntimeError("first utterance failed")
        return TranscriptionResult(
            session_id=utterance.session_id,
            utterance_id=utterance.utterance_id,
            text="second utterance succeeded",
            start=utterance.start,
            end=utterance.end,
        )


@pytest.mark.asyncio
async def test_partial_provider_failure_preserves_successful_utterances() -> None:
    pipeline = SpeechSessionPipeline(
        None,
        PartiallyFailingTranscriptionProvider(),
        UtteranceSegmenter(
            ScriptedVoiceActivityDetector({"session": [0.9, 0.0, 0.9, 0.0]}),
            SegmentationConfig(end_silence_ms=100, pre_speech_ms=0),
        ),
        aligner=SoloTranscriptAligner(),
    )
    await pipeline.start("session")
    for sequence in range(4):
        await pipeline.push(
            AudioFrame(session_id="session", sequence=sequence, pcm16=b"\x01\x00" * 1600)
        )

    result = await pipeline.finish("session")

    assert [segment.text for segment in result.transcript.segments] == [
        "second utterance succeeded"
    ]
    assert result.errors[0].utterance_id == "utterance-0001"
    assert result.errors[0].message == "first utterance failed"


class DuplicateSegmenter:
    def push(self, frame: AudioFrame) -> list[Utterance]:
        return [
            Utterance(
                session_id=frame.session_id,
                utterance_id="same-utterance",
                pcm16=frame.pcm16,
                start=0,
                end=0.1,
            )
        ]

    def flush(self, session_id: str) -> list[Utterance]:
        del session_id
        return []

    def close(self, session_id: str) -> None:
        del session_id


@pytest.mark.asyncio
async def test_duplicate_utterance_id_is_transcribed_only_once() -> None:
    transcription = FakeTranscriptionProvider()
    pipeline = SpeechSessionPipeline(
        None,
        transcription,
        DuplicateSegmenter(),  # type: ignore[arg-type]
        aligner=SoloTranscriptAligner(),
    )
    await pipeline.start("session")
    for sequence in range(2):
        await pipeline.push(
            AudioFrame(session_id="session", sequence=sequence, pcm16=b"\x01\x00" * 1600)
        )

    result = await pipeline.finish("session")

    assert transcription.utterance_ids == ["same-utterance"]
    assert [segment.utterance_id for segment in result.transcript.segments] == ["same-utterance"]
