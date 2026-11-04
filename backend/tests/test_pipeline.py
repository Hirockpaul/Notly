import asyncio

import pytest

from app.processing.alignment import SoloTranscriptAligner
from app.processing.models import AudioFrame, DiarizationSegment
from app.processing.pipeline import SpeechSessionPipeline
from app.processing.segmentation import UtteranceSegmenter
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
