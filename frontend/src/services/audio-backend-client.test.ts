import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioBackendClient } from "./audio-backend-client";
import type { PcmAudioChunk } from "../types/audio";

const chunk: PcmAudioChunk = {
  data: new Int16Array([0, 32767, -32768]),
  durationMs: 0.1875,
  sampleRate: 16000,
  sequence: 12,
};
afterEach(() => vi.useRealTimers());

describe("AudioBackendClient Tauri bridge", () => {
  it("starts, polls, and finishes through allow-listed commands", async () => {
    const invokeImplementation = vi.fn((command: string) => {
      if (command === "backend_start_session")
        return Promise.resolve({
          sessionId: "session-1",
          status: "recording",
          audioFormat: { encoding: "pcm_s16le", sampleRate: 16000, channels: 1 },
        });
      if (command === "backend_get_transcript")
        return Promise.resolve({
          sessionId: "session-1",
          status: "recording",
          transcript: { session_id: "session-1", segments: [] },
          pendingUtterances: 0,
          errors: [],
        });
      return Promise.resolve({
        sessionId: "session-1",
        status: "completed",
        transcript: { session_id: "session-1", segments: [] },
        errors: [],
      });
    });
    const client = new AudioBackendClient({ invokeImplementation });
    await client.startSession();
    await client.getSessionTranscript("session-1");
    await client.finishSession("session-1");
    expect(invokeImplementation.mock.calls.map(([command]) => command)).toEqual([
      "backend_start_session",
      "backend_get_transcript",
      "backend_finish_session",
    ]);
  });

  it("sends PCM bytes and metadata through IPC", async () => {
    const invokeImplementation = vi.fn(() =>
      Promise.resolve({
        received_bytes: 6,
        sequence: 12,
        session_id: "session-1",
        status: "recording",
      }),
    );
    const client = new AudioBackendClient({ invokeImplementation });
    await client.sendChunk(chunk, "session-1");
    expect(invokeImplementation).toHaveBeenCalledWith("backend_send_audio_chunk", {
      chunk: {
        bytes: [0, 0, 255, 127, 0, 128],
        channels: 1,
        sampleRate: 16000,
        sequence: 12,
        sessionId: "session-1",
      },
    });
  });

  it("preserves notes regeneration state", async () => {
    const invokeImplementation = vi.fn(() =>
      Promise.resolve({
        sessionId: "session-1",
        status: "completed",
        notes: {
          title: "Notes",
          summary: null,
          keyPoints: [],
          actionItems: [],
          importantInformation: [],
          decisions: [],
          additionalContext: [],
        },
      }),
    );
    const client = new AudioBackendClient({ invokeImplementation });
    await client.generateNotes("session-1", true);
    expect(invokeImplementation).toHaveBeenCalledWith("backend_generate_notes", {
      sessionId: "session-1",
      regenerate: true,
    });
  });

  it("maps structured bridge errors", async () => {
    const bridgeError = Object.assign(new Error("Invalid audio"), {
      code: "validation",
      status: 422,
    });
    const client = new AudioBackendClient({
      invokeImplementation: vi.fn(() => Promise.reject(bridgeError)),
    });
    await expect(client.sendChunk(chunk, "session-1")).rejects.toMatchObject({
      code: "validation",
      message: "Invalid audio",
      status: 422,
    });
  });

  it("reports unavailable bridge failures", async () => {
    const client = new AudioBackendClient({
      invokeImplementation: vi.fn(() => Promise.reject(new Error("connection refused"))),
    });
    await expect(client.startSession()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("applies the configured frontend timeout", async () => {
    vi.useFakeTimers();
    const client = new AudioBackendClient({
      invokeImplementation: vi.fn(() => new Promise(() => undefined)),
      timeoutMs: 50,
    });
    const expectation = expect(client.startSession()).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(51);
    await expectation;
  });
});
