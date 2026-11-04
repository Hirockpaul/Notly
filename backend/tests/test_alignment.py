from app.processing.alignment import TimestampTranscriptAligner
from app.processing.models import DiarizationSegment, TranscriptionResult


def transcript(start: float, end: float, utterance_id: str = "u1") -> TranscriptionResult:
    return TranscriptionResult(
        session_id="session",
        utterance_id=utterance_id,
        text="hello",
        start=start,
        end=end,
    )


def speaker(name: str, start: float, end: float) -> DiarizationSegment:
    return DiarizationSegment(session_id="session", speaker=name, start=start, end=end)


def test_aligns_chronologically_by_timestamp_overlap() -> None:
    result = TimestampTranscriptAligner().align(
        "session",
        [transcript(2, 3, "u2"), transcript(0, 1, "u1")],
        [speaker("Speaker 1", 0, 1), speaker("Speaker 2", 2, 3)],
    )

    assert [(item.utterance_id, item.speaker) for item in result.segments] == [
        ("u1", "Speaker 1"),
        ("u2", "Speaker 2"),
    ]


def test_marks_overlapping_speakers() -> None:
    result = TimestampTranscriptAligner().align(
        "session",
        [transcript(0, 2)],
        [speaker("Speaker 1", 0, 1.5), speaker("Speaker 2", 1, 2)],
    )

    assert result.segments[0].speaker == "Speaker 1 + Speaker 2"


def test_unknown_when_no_confident_overlap() -> None:
    result = TimestampTranscriptAligner().align("session", [transcript(0, 1)], [])
    assert result.segments[0].speaker == "Unknown"


def test_late_diarization_can_be_reconciled_by_realigning() -> None:
    aligner = TimestampTranscriptAligner()
    before = aligner.align("session", [transcript(0, 1)], [])
    after = aligner.align("session", [transcript(0, 1)], [speaker("Speaker 1", 0, 1)])

    assert before.segments[0].speaker == "Unknown"
    assert after.segments[0].speaker == "Speaker 1"
