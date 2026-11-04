from itertools import combinations

from app.processing.models import (
    AlignedTranscript,
    AlignedTranscriptSegment,
    DiarizationSegment,
    TranscriptionResult,
)


class TimestampTranscriptAligner:
    def __init__(self, minimum_overlap_ratio: float = 0.2, minimum_confidence: float = 0.5) -> None:
        self.minimum_overlap_ratio = minimum_overlap_ratio
        self.minimum_confidence = minimum_confidence

    def align(
        self,
        session_id: str,
        transcriptions: list[TranscriptionResult],
        diarization: list[DiarizationSegment],
    ) -> AlignedTranscript:
        relevant_diarization = [item for item in diarization if item.session_id == session_id]
        segments = [
            AlignedTranscriptSegment(
                utterance_id=item.utterance_id,
                speaker=self._speaker_for(item, relevant_diarization),
                text=item.text,
                start=item.start,
                end=item.end,
            )
            for item in transcriptions
            if item.session_id == session_id and item.text.strip()
        ]
        return AlignedTranscript(
            session_id=session_id,
            segments=sorted(segments, key=lambda item: (item.start, item.end)),
        )

    def _speaker_for(
        self,
        transcription: TranscriptionResult,
        diarization: list[DiarizationSegment],
    ) -> str:
        duration = transcription.end - transcription.start
        overlaps = [
            (item, _overlap(transcription.start, transcription.end, item.start, item.end))
            for item in diarization
            if item.confidence >= self.minimum_confidence
        ]
        candidates = [
            (item, overlap)
            for item, overlap in overlaps
            if overlap > 0 and overlap / duration >= self.minimum_overlap_ratio
        ]
        if not candidates:
            return "Unknown"

        overlapping_speakers: set[str] = set()
        for (left, _), (right, _) in combinations(candidates, 2):
            speakers_overlap = _overlap(left.start, left.end, right.start, right.end) > 0
            if left.speaker != right.speaker and speakers_overlap:
                overlapping_speakers.update((left.speaker, right.speaker))
        if overlapping_speakers:
            return " + ".join(sorted(overlapping_speakers))

        candidates.sort(key=lambda candidate: candidate[1], reverse=True)
        if len(candidates) > 1 and candidates[0][1] == candidates[1][1]:
            return "Unknown"
        return candidates[0][0].speaker


def _overlap(left_start: float, left_end: float, right_start: float, right_end: float) -> float:
    return max(0.0, min(left_end, right_end) - max(left_start, right_start))


class SoloTranscriptAligner(TimestampTranscriptAligner):
    """Produces the existing transcript schema without running diarization."""

    def _speaker_for(
        self,
        transcription: TranscriptionResult,
        diarization: list[DiarizationSegment],
    ) -> str:
        del transcription, diarization
        return "You"
