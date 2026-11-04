from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.processing.models import AlignedTranscript
from app.services.speech_sessions import (
    PipelineProcessingError,
    SessionNotFoundError,
    speech_session_manager,
)

router = APIRouter(tags=["sessions"])


class AudioFormat(BaseModel):
    encoding: Literal["pcm_s16le"] = "pcm_s16le"
    sampleRate: Literal[16000] = 16000
    channels: Literal[1] = 1


class StartSessionResponse(BaseModel):
    sessionId: str
    status: Literal["recording"] = "recording"
    audioFormat: AudioFormat = AudioFormat()


class FinishSessionResponse(BaseModel):
    sessionId: str
    status: Literal["completed"] = "completed"
    transcript: AlignedTranscript


@router.post("/start", response_model=StartSessionResponse, status_code=status.HTTP_201_CREATED)
async def start_session() -> StartSessionResponse:
    session = await speech_session_manager.start()
    return StartSessionResponse(sessionId=session.session_id)


@router.post("/{session_id}/finish", response_model=FinishSessionResponse)
async def finish_session(session_id: str) -> FinishSessionResponse:
    try:
        transcript = await speech_session_manager.finish(session_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except PipelineProcessingError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "pipeline_failed", "message": str(error), "errors": error.errors},
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "pipeline_failed", "message": "Speech processing failed."},
        ) from error
    return FinishSessionResponse(sessionId=session_id, transcript=transcript)
