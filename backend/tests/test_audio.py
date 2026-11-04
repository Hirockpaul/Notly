from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

VALID_HEADERS = {
    "Content-Type": "application/octet-stream",
    "X-Noto-Sample-Rate": "16000",
    "X-Noto-Channels": "1",
    "X-Noto-Sequence": "0",
    "X-Noto-Session-Id": "test-session",
}
MISSING_SEQUENCE_HEADERS = {
    key: value for key, value in VALID_HEADERS.items() if key != "X-Noto-Sequence"
}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as test_client:
        yield test_client


@pytest.mark.anyio
async def test_valid_pcm16_chunk_is_acknowledged(client: AsyncClient) -> None:
    started = await client.post("/api/sessions/start")
    session_id = started.json()["sessionId"]
    payload = bytes([0, 0, 255, 127, 0, 128])
    response = await client.post(
        "/api/audio/chunks",
        content=payload,
        headers={**VALID_HEADERS, "X-Noto-Session-Id": session_id},
    )

    assert response.status_code == 200
    assert response.json() == {
        "received_bytes": len(payload),
        "sequence": 0,
        "session_id": session_id,
        "status": "recording",
    }
    await client.post(f"/api/sessions/{session_id}/finish")


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("payload", "headers", "expected_status"),
    [
        (b"", VALID_HEADERS, 400),
        (b"\x00", VALID_HEADERS, 400),
        (b"\x00\x00", {**VALID_HEADERS, "X-Noto-Sample-Rate": "48000"}, 422),
        (b"\x00\x00", {**VALID_HEADERS, "X-Noto-Channels": "2"}, 422),
        (b"\x00\x00", MISSING_SEQUENCE_HEADERS, 422),
        (b"\x00\x00", {**VALID_HEADERS, "X-Noto-Sequence": "not-a-number"}, 422),
        (b"\x00\x00", {**VALID_HEADERS, "X-Noto-Sequence": "-1"}, 422),
    ],
)
async def test_invalid_audio_chunks_are_rejected(
    client: AsyncClient,
    payload: bytes,
    headers: dict[str, str],
    expected_status: int,
) -> None:
    response = await client.post("/api/audio/chunks", content=payload, headers=headers)
    assert response.status_code == expected_status
