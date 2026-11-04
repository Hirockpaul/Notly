import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioBackendClient } from "./audio-backend-client";
import { AudioChunkTransport } from "./audio-chunk-transport";
import type { PcmAudioChunk } from "../types/audio";

const chunk: PcmAudioChunk = {
  data: new Int16Array([0, 32767, -32768]),
  durationMs: 0.1875,
  sampleRate: 16000,
  sequence: 12,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("AudioBackendClient", () => {
  it("starts and finishes backend-owned speech sessions", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "server-session",
            status: "recording",
            audioFormat: { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 },
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sessionId: "server-session",
            status: "completed",
            transcript: { session_id: "server-session", segments: [] },
            errors: [],
          }),
          { status: 200 },
        ),
      );
    const client = new AudioBackendClient({ fetchImplementation });

    const started = await client.startSession();
    const finished = await client.finishSession(started.sessionId);

    expect(started.sessionId).toBe("server-session");
    expect(finished.status).toBe("completed");
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:8765/api/sessions/start",
      "http://127.0.0.1:8765/api/sessions/server-session/finish",
    ]);
    expect(fetchImplementation.mock.calls.map(([, request]) => request?.method)).toEqual([
      "POST",
      "POST",
    ]);
  });

  it("retrieves a full reconnectable transcript snapshot with GET", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          sessionId: "server-session",
          status: "recording",
          transcript: { session_id: "server-session", segments: [] },
          pendingUtterances: 1,
          errors: [],
        }),
        { status: 200 },
      ),
    );
    const client = new AudioBackendClient({ fetchImplementation });

    const snapshot = await client.getSessionTranscript("server-session");

    expect(snapshot.pendingUtterances).toBe(1);
    expect(fetchImplementation.mock.calls[0][1]?.method).toBe("GET");
  });

  it("sends raw PCM16 bytes with the required metadata headers", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ received_bytes: 6, sequence: 12 }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const client = new AudioBackendClient({
      baseUrl: "http://127.0.0.1:8765/",
      fetchImplementation,
    });

    await client.sendChunk(chunk, "session-123");

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8765/api/audio/chunks");
    expect(request?.headers).toMatchObject({
      "Content-Type": "application/octet-stream",
      "X-Noto-Channels": "1",
      "X-Noto-Sample-Rate": "16000",
      "X-Noto-Sequence": "12",
      "X-Noto-Session-Id": "session-123",
    });
    expect(Array.from(request?.body as Uint8Array)).toEqual([0, 0, 255, 127, 0, 128]);
  });

  it("reports an unavailable backend without exposing the request body", async () => {
    const client = new AudioBackendClient({
      fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
    });

    await expect(client.sendChunk(chunk, "session-123")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("aborts requests that exceed the timeout", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_url, request) => {
      return new Promise((_resolve, reject) => {
        request?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    const client = new AudioBackendClient({ fetchImplementation, timeoutMs: 50 });

    const expectation = expect(client.sendChunk(chunk, "session-123")).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(51);
    await expectation;
  });

  it("returns backend validation errors", async () => {
    const client = new AudioBackendClient({
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sample rate must be 16000 Hz." }), {
          headers: { "Content-Type": "application/json" },
          status: 422,
        }),
      ),
    });

    await expect(client.sendChunk(chunk, "session-123")).rejects.toEqual(
      expect.objectContaining({
        code: "validation",
        message: "Sample rate must be 16000 Hz.",
        status: 422,
      }),
    );
  });
});

describe("AudioChunkTransport", () => {
  it("delivers queued chunks before requesting the final transcript", async () => {
    const requestedPaths: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((url) => {
      const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      const path = new URL(requestUrl).pathname;
      requestedPaths.push(path);
      if (path.endsWith("/start")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sessionId: "session-123",
              status: "recording",
              audioFormat: { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 },
            }),
            { status: 201 },
          ),
        );
      }
      if (path.endsWith("/chunks")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              received_bytes: 6,
              sequence: 12,
              session_id: "session-123",
              status: "recording",
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            sessionId: "session-123",
            status: "completed",
            transcript: {
              session_id: "session-123",
              segments: [
                {
                  utterance_id: "utterance-0001",
                  speaker: "You",
                  text: "Speech detected.",
                  start: 0,
                  end: 1,
                },
              ],
            },
            errors: [],
          }),
          { status: 200 },
        ),
      );
    });
    const transport = new AudioChunkTransport({
      client: new AudioBackendClient({ fetchImplementation }),
      onError: vi.fn(),
    });

    await transport.startSession();
    transport.enqueue(chunk);
    const result = await transport.finishSession();

    expect(requestedPaths).toEqual([
      "/api/sessions/start",
      "/api/audio/chunks",
      "/api/sessions/session-123/finish",
    ]);
    expect(result.transcript.segments[0].speaker).toBe("You");
  });

  it("does not transmit chunks while paused or after disposal", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessionId: "session-123",
          status: "recording",
          audioFormat: { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 },
        }),
        { headers: { "Content-Type": "application/json" }, status: 201 },
      ),
    );
    const transport = new AudioChunkTransport({
      client: new AudioBackendClient({ fetchImplementation }),
      onError: vi.fn(),
    });

    await transport.startSession();
    transport.pause();
    transport.enqueue(chunk);
    transport.dispose();
    transport.enqueue(chunk);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation.mock.calls[0][0]).toBe("http://127.0.0.1:8765/api/sessions/start");
  });
});
