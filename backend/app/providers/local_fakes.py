from array import array


class FakeVoiceActivityDetector:
    """Deterministic, dependency-free energy detector used by the local fake pipeline."""

    def __init__(self, speech_rms_threshold: float = 450.0) -> None:
        self._threshold = speech_rms_threshold

    def score(self, session_id: str, pcm16: bytes, sample_rate: int) -> float:
        del session_id, sample_rate
        samples = array("h")
        samples.frombytes(pcm16)
        if not samples:
            return 0.0
        mean_square = sum(sample * sample for sample in samples) / len(samples)
        rms = mean_square**0.5
        return 1.0 if rms >= self._threshold else 0.0

    def reset(self, session_id: str) -> None:
        del session_id
