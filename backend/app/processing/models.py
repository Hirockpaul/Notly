from pydantic import BaseModel, ConfigDict, Field


class AudioFrame(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_id: str
    sequence: int = Field(ge=0)
    pcm16: bytes = Field(repr=False)
    sample_rate: int = 16000
    channel_count: int = 1

    @property
    def duration_seconds(self) -> float:
        return len(self.pcm16) / (self.sample_rate * self.channel_count * 2)


class Utterance(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_id: str
    utterance_id: str
    pcm16: bytes = Field(repr=False)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    sample_rate: int = 16000


class DiarizationSegment(BaseModel):
    session_id: str
    speaker: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    confidence: float = Field(default=1.0, ge=0, le=1)


class TranscriptWord(BaseModel):
    text: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class TranscriptionResult(BaseModel):
    session_id: str
    utterance_id: str
    text: str
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    words: list[TranscriptWord] = Field(default_factory=list)


class AlignedTranscriptSegment(BaseModel):
    utterance_id: str
    speaker: str
    text: str
    start: float
    end: float


class AlignedTranscript(BaseModel):
    session_id: str
    segments: list[AlignedTranscriptSegment]
