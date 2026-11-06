import asyncio
from collections import OrderedDict

from app.core.config import settings
from app.notes.models import NotesDocument
from app.notes.providers import (
    FakeNotesProvider,
    NotesProvider,
    OpenAICompatibleNotesConfig,
    OpenAICompatibleNotesProvider,
)
from app.processing.models import AlignedTranscript

MAX_RETAINED_NOTES = 100


class EmptyTranscriptError(ValueError):
    pass


def create_notes_provider() -> NotesProvider:
    if settings.notes_provider == "fake":
        return FakeNotesProvider()
    return OpenAICompatibleNotesProvider(
        OpenAICompatibleNotesConfig(
            api_url=settings.notes_api_url,
            api_key=settings.notes_api_key,
            model=settings.notes_model,
            timeout_seconds=settings.notes_timeout_seconds,
        )
    )


class NotesService:
    def __init__(
        self,
        provider: NotesProvider | None = None,
        max_retained_notes: int = MAX_RETAINED_NOTES,
    ) -> None:
        self._provider = provider or create_notes_provider()
        self._max_retained_notes = max_retained_notes
        self._notes: OrderedDict[str, NotesDocument] = OrderedDict()
        self._generation_tasks: dict[str, asyncio.Task[NotesDocument]] = {}
        self._lock = asyncio.Lock()

    async def generate(
        self,
        session_id: str,
        transcript: AlignedTranscript,
        regenerate: bool = False,
    ) -> NotesDocument:
        if not any(segment.text.strip() for segment in transcript.segments):
            raise EmptyTranscriptError("A meaningful transcript is required to generate notes.")

        async with self._lock:
            existing_task = self._generation_tasks.get(session_id)
            if existing_task is not None:
                task = existing_task
            elif not regenerate and session_id in self._notes:
                self._notes.move_to_end(session_id)
                return self._notes[session_id]
            else:
                task = asyncio.create_task(self._provider.generate(transcript))
                self._generation_tasks[session_id] = task

        try:
            notes = await task
        finally:
            async with self._lock:
                if self._generation_tasks.get(session_id) is task:
                    self._generation_tasks.pop(session_id, None)

        async with self._lock:
            self._notes[session_id] = notes
            self._notes.move_to_end(session_id)
            while len(self._notes) > self._max_retained_notes:
                self._notes.popitem(last=False)
        return notes


notes_service = NotesService()
