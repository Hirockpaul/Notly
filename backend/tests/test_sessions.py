import asyncio
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.processing.models import DiarizationSegment, TranscriptionResult, Utterance
from app.processing.pipeline import SpeechSessionPipeline
from app.processing.segmentation import UtteranceSegmenter
from app.providers.fakes import FakeDiarizationProvider, ScriptedVoiceActivityDetector
from app.services.speech_sessions import SessionNotFoundError, SpeechSessionManager


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        yield value


def pcm(amplitude: int = 1000, samples: int = 1600) -> bytes:
    return amplitude.to_bytes(2, "little", signed=True) * samples


async def start(client: AsyncClient) -> str:
    response = await client.post("/api/sessions/start")
    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "recording"
    assert payload["audioFormat"] == {
        "encoding": "pcm_s16le",
        "sampleRate": 16000,
        "channels": 1,
    }
    return payload["sessionId"]


async def push(client: AsyncClient, session_id: str, sequence: int, body: bytes):
    return await client.post(
        "/api/audio/chunks",
        content=body,
        headers={
            "Content-Type": "application/octet-stream",
            "X-Noto-Sample-Rate": "16000",
            "X-Noto-Channels": "1",
            "X-Noto-Sequence": str(sequence),
            "X-Noto-Session-Id": session_id,
        },
    )


@pytest.mark.anyio
async def test_sessions_are_unique_and_isolated(client: AsyncClient) -> None:
    first, second = await start(client), await start(client)
    assert first != second
    assert (await push(client, first, 0, pcm())).status_code == 200
    assert (await push(client, second, 0, pcm())).status_code == 200
    await client.post(f"/api/sessions/{first}/finish")
    await client.post(f"/api/sessions/{second}/finish")


@pytest.mark.anyio
async def test_sequence_unknown_and_finished_session_rejections(client: AsyncClient) -> None:
    session_id = await start(client)
    assert (await push(client, session_id, 1, pcm())).status_code == 409
    assert (await push(client, "missing", 0, pcm())).status_code == 404
    assert (await push(client, session_id, 0, pcm())).status_code == 200
    await client.post(f"/api/sessions/{session_id}/finish")
    assert (await push(client, session_id, 1, pcm())).status_code == 409


@pytest.mark.anyio
async def test_finish_flushes_audio_returns_transcript_and_is_idempotent(
    client: AsyncClient,
) -> None:
    session_id = await start(client)
    assert (await push(client, session_id, 0, pcm())).status_code == 200

    first = await client.post(f"/api/sessions/{session_id}/finish")
    second = await client.post(f"/api/sessions/{session_id}/finish")

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    segment = first.json()["transcript"]["segments"][0]
    assert segment == {
        "utterance_id": "utterance-0001",
        "speaker": "You",
        "text": "Speech detected by the local test provider.",
        "start": 0.0,
        "end": 0.1,
    }


@pytest.mark.anyio
async def test_silence_does_not_fabricate_a_transcript(client: AsyncClient) -> None:
    session_id = await start(client)
    await push(client, session_id, 0, pcm(amplitude=0))
    response = await client.post(f"/api/sessions/{session_id}/finish")
    assert response.status_code == 200
    assert response.json()["transcript"]["segments"] == []


class FailingTranscription:
    async def transcribe(self, utterance: Utterance) -> TranscriptionResult:
        del utterance
        raise RuntimeError("provider unavailable")


@pytest.mark.asyncio
async def test_manager_reports_provider_failure_and_cleans_resources() -> None:
    def factory(session_id: str) -> SpeechSessionPipeline:
        return SpeechSessionPipeline(
            FakeDiarizationProvider(
                {
                    session_id: [
                        DiarizationSegment(
                            session_id=session_id, speaker="Speaker 1", start=0, end=0.1
                        )
                    ]
                }
            ),
            FailingTranscription(),
            UtteranceSegmenter(ScriptedVoiceActivityDetector({session_id: [0.9]})),
        )

    manager = SpeechSessionManager(factory)
    session = await manager.start()
    await manager.push(session.session_id, 0, pcm(), 16000, 1)

    result = await manager.finish(session.session_id)
    assert result.transcript.segments == []
    assert result.errors[0].utterance_id == "utterance-0001"
    assert result.errors[0].message == "provider unavailable"
    assert manager.active_session_count == 0

    snapshot = await manager.progress(session.session_id)
    assert snapshot.status == "completed_with_errors"
    assert snapshot.result == result


@pytest.mark.asyncio
async def test_idle_disconnected_session_is_cleaned_up() -> None:
    manager = SpeechSessionManager(session_idle_timeout_seconds=0.01)
    session = await manager.start()

    await asyncio.sleep(0.02)

    assert manager.active_session_count == 0
    with pytest.raises(SessionNotFoundError, match="Unknown speech session"):
        await manager.progress(session.session_id)


@pytest.mark.anyio
async def test_progress_endpoint_is_reconnectable_after_finish(client: AsyncClient) -> None:
    session_id = await start(client)
    await push(client, session_id, 0, pcm())

    recording = await client.get(f"/api/sessions/{session_id}/transcript")
    assert recording.status_code == 200
    assert recording.json()["status"] == "recording"

    await client.post(f"/api/sessions/{session_id}/finish")
    completed = await client.get(f"/api/sessions/{session_id}/transcript")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["pendingUtterances"] == 0
    assert len(completed.json()["transcript"]["segments"]) == 1


@pytest.mark.anyio
async def test_progress_endpoint_rejects_unknown_session(client: AsyncClient) -> None:
    response = await client.get("/api/sessions/missing/transcript")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_notes_endpoint_requires_completed_nonempty_session(client: AsyncClient) -> None:
    unfinished = await start(client)
    assert (await client.post(f"/api/sessions/{unfinished}/notes", json={})).status_code == 409

    empty = await start(client)
    await push(client, empty, 0, pcm(amplitude=0))
    await client.post(f"/api/sessions/{empty}/finish")
    response = await client.post(f"/api/sessions/{empty}/notes", json={})
    assert response.status_code == 422
    assert response.json()["detail"] == "A meaningful transcript is required to generate notes."


@pytest.mark.anyio
async def test_notes_endpoint_generates_caches_and_regenerates_without_mutating_transcript(
    client: AsyncClient,
) -> None:
    session_id = await start(client)
    await push(client, session_id, 0, pcm())
    finished = await client.post(f"/api/sessions/{session_id}/finish")
    original_transcript = finished.json()["transcript"]

    generated = await client.post(f"/api/sessions/{session_id}/notes", json={})
    cached = await client.post(f"/api/sessions/{session_id}/notes", json={})
    regenerated = await client.post(f"/api/sessions/{session_id}/notes", json={"regenerate": True})
    transcript_after = await client.get(f"/api/sessions/{session_id}/transcript")

    assert generated.status_code == cached.status_code == regenerated.status_code == 200
    assert generated.json() == cached.json() == regenerated.json()
    assert generated.json()["notes"]["keyPoints"] == ["Speech detected by the local test provider."]
    assert transcript_after.json()["transcript"] == original_transcript
