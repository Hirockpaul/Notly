from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel

from app.services.speech_sessions import (
    MAX_CHUNK_BYTES,
    SequenceError,
    SessionNotFoundError,
    SessionStateError,
    speech_session_manager,
)

router = APIRouter(tags=["audio"])


class AudioChunkAcknowledgement(BaseModel):
    received_bytes: int
    sequence: int
    session_id: str
    status: str


@router.post("/chunks", response_model=AudioChunkAcknowledgement)
async def receive_audio_chunk(
    request: Request,
    sample_rate: Annotated[int, Header(alias="X-Noto-Sample-Rate")],
    channel_count: Annotated[int, Header(alias="X-Noto-Channels")],
    sequence: Annotated[int, Header(alias="X-Noto-Sequence", ge=0)],
    session_id: Annotated[str, Header(alias="X-Noto-Session-Id", min_length=1, max_length=128)],
    content_type: Annotated[str, Header(alias="Content-Type")],
) -> AudioChunkAcknowledgement:
    payload = await request.body()

    if content_type.split(";", maxsplit=1)[0].strip().lower() != "application/octet-stream":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Audio chunks must use application/octet-stream.",
        )
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audio chunk payload cannot be empty.",
        )
    if len(payload) % 2 != 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PCM16 payload byte length must be even.",
        )
    if len(payload) > MAX_CHUNK_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Audio chunk exceeds the two-second size limit.",
        )
    if sample_rate != 16000:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Sample rate must be 16000 Hz.",
        )
    if channel_count != 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Audio must contain exactly one channel.",
        )

    try:
        session = await speech_session_manager.push(
            session_id, sequence, payload, sample_rate, channel_count
        )
    except SessionNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except SessionStateError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except SequenceError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error

    return AudioChunkAcknowledgement(
        received_bytes=len(payload),
        sequence=sequence,
        session_id=session_id,
        status=session.status,
    )
