from collections import defaultdict, deque

from app.processing.models import AudioFrame, DiarizationSegment, TranscriptionResult, Utterance


class ScriptedVoiceActivityDetector:
    """Deterministic test double; not a production VAD algorithm."""

    def __init__(self, scores: dict[str, list[float]]) -> None:
        self._scores = {session_id: deque(values) for session_id, values in scores.items()}

    def score(self, session_id: str, pcm16: bytes, sample_rate: int) -> float:
        del pcm16, sample_rate
        values = self._scores.get(session_id)
        return values.popleft() if values else 0.0

    def reset(self, session_id: str) -> None:
        self._scores.pop(session_id, None)


class FakeDiarizationProvider:
    def __init__(self, segments: dict[str, list[DiarizationSegment]] | None = None) -> None:
        self._segments = segments or {}
        self.frames: dict[str, list[int]] = defaultdict(list)
        self.active_sessions: set[str] = set()

    async def start_session(self, session_id: str) -> None:
        self.active_sessions.add(session_id)

    async def push_audio(self, frame: AudioFrame) -> list[DiarizationSegment]:
        if frame.session_id not in self.active_sessions:
            raise RuntimeError("Diarization session is not active.")
        self.frames[frame.session_id].append(frame.sequence)
        return []

    async def finish_session(self, session_id: str) -> list[DiarizationSegment]:
        return list(self._segments.get(session_id, []))

    async def close_session(self, session_id: str) -> None:
        self.active_sessions.discard(session_id)
        self.frames.pop(session_id, None)


class FakeTranscriptionProvider:
    def __init__(self, text: str = "Synthetic transcript") -> None:
        self.text = text
        self.utterance_ids: list[str] = []

    async def transcribe(self, utterance: Utterance) -> TranscriptionResult:
        self.utterance_ids.append(utterance.utterance_id)
        return TranscriptionResult(
            session_id=utterance.session_id,
            utterance_id=utterance.utterance_id,
            text=self.text,
            start=utterance.start,
            end=utterance.end,
        )
