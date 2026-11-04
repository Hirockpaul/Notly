from collections import defaultdict, deque
from dataclasses import dataclass, field

from app.processing.models import AudioFrame, Utterance
from app.providers.interfaces import VoiceActivityDetector


@dataclass(frozen=True, slots=True)
class SegmentationConfig:
    speech_start_threshold: float = 0.6
    silence_threshold: float = 0.35
    end_silence_ms: int = 600
    pre_speech_ms: int = 250
    max_utterance_seconds: float = 30.0


@dataclass(slots=True)
class _BufferedFrame:
    pcm16: bytes
    start: float
    end: float


@dataclass(slots=True)
class _SessionState:
    next_time: float = 0.0
    utterance_number: int = 0
    silence_ms: float = 0.0
    active: bool = False
    pre_speech: deque[_BufferedFrame] = field(default_factory=deque)
    utterance: list[_BufferedFrame] = field(default_factory=list)


class UtteranceSegmenter:
    def __init__(
        self,
        detector: VoiceActivityDetector,
        config: SegmentationConfig | None = None,
    ) -> None:
        self.detector = detector
        self.config = config or SegmentationConfig()
        self._sessions: dict[str, _SessionState] = defaultdict(_SessionState)

    @property
    def active_session_count(self) -> int:
        return len(self._sessions)

    def push(self, frame: AudioFrame) -> list[Utterance]:
        if frame.sample_rate != 16000 or frame.channel_count != 1 or len(frame.pcm16) % 2:
            raise ValueError("Segmentation requires mono 16 kHz PCM16 audio.")

        state = self._sessions[frame.session_id]
        duration = frame.duration_seconds
        buffered = _BufferedFrame(
            pcm16=frame.pcm16,
            start=state.next_time,
            end=state.next_time + duration,
        )
        state.next_time = buffered.end
        score = self.detector.score(frame.session_id, frame.pcm16, frame.sample_rate)

        if not state.active:
            state.pre_speech.append(buffered)
            self._trim_pre_speech(state)
            if score >= self.config.speech_start_threshold:
                state.active = True
                state.utterance = list(state.pre_speech)
                state.pre_speech.clear()
            return []

        state.utterance.append(buffered)
        state.silence_ms = (
            state.silence_ms + duration * 1000 if score <= self.config.silence_threshold else 0
        )

        utterance_duration = state.utterance[-1].end - state.utterance[0].start
        if state.silence_ms >= self.config.end_silence_ms or (
            utterance_duration >= self.config.max_utterance_seconds
        ):
            return [self._finish_utterance(frame.session_id, state)]
        return []

    def flush(self, session_id: str) -> list[Utterance]:
        state = self._sessions.pop(session_id, None)
        self.detector.reset(session_id)
        if not state or not state.active or not state.utterance:
            return []
        return [self._build_utterance(session_id, state)]

    def close(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        self.detector.reset(session_id)

    def _trim_pre_speech(self, state: _SessionState) -> None:
        maximum_seconds = self.config.pre_speech_ms / 1000
        # A capture frame may be longer than the requested look-back window. Keep
        # that newest frame so speech onset is never discarded entirely.
        while (
            len(state.pre_speech) > 1
            and state.pre_speech[-1].end - state.pre_speech[0].start > maximum_seconds
        ):
            state.pre_speech.popleft()

    def _finish_utterance(self, session_id: str, state: _SessionState) -> Utterance:
        utterance = self._build_utterance(session_id, state)
        state.active = False
        state.silence_ms = 0
        state.utterance = []
        state.pre_speech.clear()
        return utterance

    def _build_utterance(self, session_id: str, state: _SessionState) -> Utterance:
        state.utterance_number += 1
        return Utterance(
            session_id=session_id,
            utterance_id=f"utterance-{state.utterance_number:04d}",
            pcm16=b"".join(frame.pcm16 for frame in state.utterance),
            start=state.utterance[0].start,
            end=state.utterance[-1].end,
        )
