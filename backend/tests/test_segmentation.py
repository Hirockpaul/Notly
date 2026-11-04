import pytest

from app.processing.models import AudioFrame
from app.processing.segmentation import SegmentationConfig, UtteranceSegmenter
from app.providers.fakes import ScriptedVoiceActivityDetector


def frame(session_id: str, sequence: int, milliseconds: int = 100) -> AudioFrame:
    samples = 16000 * milliseconds // 1000
    return AudioFrame(session_id=session_id, sequence=sequence, pcm16=b"\x00\x00" * samples)


def test_segments_speech_with_prebuffer_and_trailing_silence() -> None:
    detector = ScriptedVoiceActivityDetector({"a": [0.0, 0.9, 0.8, 0.1, 0.1]})
    segmenter = UtteranceSegmenter(
        detector,
        SegmentationConfig(pre_speech_ms=200, end_silence_ms=200),
    )

    results = []
    for sequence in range(5):
        results.extend(segmenter.push(frame("a", sequence)))

    assert len(results) == 1
    assert results[0].start == 0.0
    assert results[0].end == 0.5
    assert len(results[0].pcm16) == 5 * 3200


def test_flush_emits_active_utterance_and_cleans_session() -> None:
    segmenter = UtteranceSegmenter(ScriptedVoiceActivityDetector({"a": [0.9]}))
    segmenter.push(frame("a", 0))

    results = segmenter.flush("a")

    assert [result.utterance_id for result in results] == ["utterance-0001"]
    assert segmenter.active_session_count == 0


def test_sessions_are_isolated() -> None:
    detector = ScriptedVoiceActivityDetector({"a": [0.9], "b": [0.0]})
    segmenter = UtteranceSegmenter(detector)
    segmenter.push(frame("a", 0))
    segmenter.push(frame("b", 0))

    assert len(segmenter.flush("a")) == 1
    assert segmenter.flush("b") == []


def test_maximum_utterance_bounds_memory() -> None:
    detector = ScriptedVoiceActivityDetector({"a": [0.9, 0.9, 0.9]})
    segmenter = UtteranceSegmenter(
        detector,
        SegmentationConfig(pre_speech_ms=0, max_utterance_seconds=0.3),
    )

    results = []
    for sequence in range(3):
        results.extend(segmenter.push(frame("a", sequence)))

    assert len(results) == 1
    assert results[0].end == pytest.approx(0.3)


def test_capture_frame_larger_than_prebuffer_is_retained() -> None:
    segmenter = UtteranceSegmenter(
        ScriptedVoiceActivityDetector({"a": [0.9]}),
        SegmentationConfig(pre_speech_ms=50),
    )
    segmenter.push(frame("a", 0, milliseconds=500))

    assert len(segmenter.flush("a")[0].pcm16) == 16000
