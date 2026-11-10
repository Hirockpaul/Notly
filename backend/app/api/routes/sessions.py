from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.notes.models import NotesDocument
from app.notes.providers import (
    NotesAuthenticationError,
    NotesInvalidResponseError,
    NotesProviderError,
    NotesTimeoutError,
)
from app.processing.models import AlignedTranscript
from app.services.notes import EmptyTranscriptError, notes_service
from app.services.speech_sessions import (
    SessionNotFoundError,
    SessionStateError,
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


class StartSessionRequest(BaseModel):
    languageCode: Literal["en-US", "hi-IN"] = "en-US"


class UtteranceError(BaseModel):
    utteranceId: str
    message: str


class FinishSessionResponse(BaseModel):
    sessionId: str
    status: Literal["completed", "completed_with_errors"]
    transcript: AlignedTranscript
    errors: list[UtteranceError]


class SessionProgressResponse(BaseModel):
    sessionId: str
    status: Literal["recording", "processing", "completed", "completed_with_errors"]
    transcript: AlignedTranscript
    pendingUtterances: int
    errors: list[UtteranceError]


class GenerateNotesRequest(BaseModel):
    regenerate: bool = False


class GenerateNotesResponse(BaseModel):
    sessionId: str
    status: Literal["completed"] = "completed"
    notes: NotesDocument


@router.post("/start", response_model=StartSessionResponse, status_code=status.HTTP_201_CREATED)
async def start_session(
    request: StartSessionRequest | None = None,
) -> StartSessionResponse:
    session = await speech_session_manager.start(request.languageCode if request else "en-US")
    return StartSessionResponse(sessionId=session.session_id)


@router.post("/{session_id}/finish", response_model=FinishSessionResponse)
async def finish_session(session_id: str) -> FinishSessionResponse:
    try:
        result = await speech_session_manager.finish(session_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "pipeline_failed", "message": "Speech processing failed."},
        ) from error
    return FinishSessionResponse(
        sessionId=session_id,
        status="completed_with_errors" if result.errors else "completed",
        transcript=result.transcript,
        errors=[
            UtteranceError(utteranceId=error.utterance_id, message=error.message)
            for error in result.errors
        ],
    )


@router.get("/{session_id}/transcript", response_model=SessionProgressResponse)
async def get_session_transcript(session_id: str) -> SessionProgressResponse:
    try:
        snapshot = await speech_session_manager.progress(session_id)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return SessionProgressResponse(
        sessionId=session_id,
        status=snapshot.status,
        transcript=snapshot.result.transcript,
        pendingUtterances=snapshot.result.pending_utterances,
        errors=[
            UtteranceError(utteranceId=error.utterance_id, message=error.message)
            for error in snapshot.result.errors
        ],
    )


@router.post("/{session_id}/notes", response_model=GenerateNotesResponse)
async def generate_session_notes(
    session_id: str, request: GenerateNotesRequest
) -> GenerateNotesResponse:
    try:
        transcript = speech_session_manager.completed_result(session_id).transcript
        notes = await notes_service.generate(session_id, transcript, request.regenerate)
    except SessionNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    except SessionStateError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except EmptyTranscriptError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except NotesAuthenticationError as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(error)) from error
    except NotesTimeoutError as error:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(error)
        ) from error
    except NotesInvalidResponseError as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error
    except NotesProviderError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The hosted notes provider could not generate notes.",
        ) from error
    return GenerateNotesResponse(sessionId=session_id, notes=notes)
