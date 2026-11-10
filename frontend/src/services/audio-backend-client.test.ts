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

function bridgeInvoke(
  handler: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
  let registration = 0;
  return vi.fn((command: string, args?: Record<string, unknown>) => {
    if (command === "backend_register_request") {
      registration += 1;
      return Promise.resolve(`registration-${registration}`);
    }
    if (command === "backend_cancel_request") return Promise.resolve();
    return handler(command, args);
  });
}

describe("AudioBackendClient Tauri bridge", () => {
  it("starts, polls, and finishes through allow-listed commands", async () => {
    const invokeImplementation = bridgeInvoke((command: string) => {
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
    await client.startSession("hi-IN");
    await client.getSessionTranscript("session-1");
    await client.finishSession("session-1");
    expect(
      invokeImplementation.mock.calls
        .map(([command]) => command)
        .filter(
          (command) => !["backend_register_request", "backend_cancel_request"].includes(command),
        ),
    ).toEqual(["backend_start_session", "backend_get_transcript", "backend_finish_session"]);
    expect(invokeImplementation).toHaveBeenCalledWith(
      "backend_start_session",
      expect.objectContaining({ languageCode: "hi-IN" }),
    );
  });

  it("sends PCM bytes and metadata through IPC", async () => {
    const invokeImplementation = bridgeInvoke(() =>
      Promise.resolve({
        received_bytes: 6,
        sequence: 12,
        session_id: "session-1",
        status: "recording",
      }),
    );
    const client = new AudioBackendClient({ invokeImplementation });
    await client.sendChunk(chunk, "session-1");
    expect(invokeImplementation).toHaveBeenCalledWith(
      "backend_send_audio_chunk",
      expect.objectContaining({
        chunk: {
          bytes: [0, 0, 255, 127, 0, 128],
          channels: 1,
          sampleRate: 16000,
          sequence: 12,
          sessionId: "session-1",
        },
        requestId: expect.stringMatching(/^request-/) as unknown as string,
        registrationId: "registration-1",
      }),
    );
  });

  it("preserves notes regeneration state", async () => {
    const invokeImplementation = bridgeInvoke(() =>
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
    expect(invokeImplementation).toHaveBeenCalledWith(
      "backend_generate_notes",
      expect.objectContaining({
        sessionId: "session-1",
        regenerate: true,
        requestId: expect.stringMatching(/^request-/) as unknown as string,
        registrationId: "registration-1",
      }),
    );
  });

  it("maps structured bridge errors", async () => {
    const bridgeError = Object.assign(new Error("Invalid audio"), {
      code: "validation",
      status: 422,
    });
    const client = new AudioBackendClient({
      invokeImplementation: bridgeInvoke(() => Promise.reject(bridgeError)),
    });
    await expect(client.sendChunk(chunk, "session-1")).rejects.toMatchObject({
      code: "validation",
      message: "Invalid audio",
      status: 422,
    });
  });

  it("reports unavailable bridge failures", async () => {
    const client = new AudioBackendClient({
      invokeImplementation: bridgeInvoke(() => Promise.reject(new Error("connection refused"))),
    });
    await expect(client.startSession()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("applies the configured frontend timeout", async () => {
    vi.useFakeTimers();
    const client = new AudioBackendClient({
      invokeImplementation: bridgeInvoke(() => new Promise(() => undefined)),
      timeoutMs: 50,
    });
    const expectation = expect(client.startSession()).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(51);
    await expectation;
  });

  it("does not dispatch when the signal was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const invokeImplementation = vi.fn(() => new Promise(() => undefined));
    const client = new AudioBackendClient({ invokeImplementation });
    await expect(client.startSession("en-US", controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(invokeImplementation).not.toHaveBeenCalled();
  });

  it("cancels a registration that completes after an abort without dispatching", async () => {
    let resolveRegistration!: (registrationId: string) => void;
    const registration = new Promise<string>((resolve) => {
      resolveRegistration = resolve;
    });
    const invokeImplementation = vi.fn((command: string) => {
      if (command === "backend_register_request") return registration;
      return Promise.resolve();
    });
    const controller = new AbortController();
    const client = new AudioBackendClient({ invokeImplementation });
    const request = client.startSession("en-US", controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: "cancelled" });

    resolveRegistration("late-registration");
    await Promise.resolve();
    await Promise.resolve();
    expect(invokeImplementation).toHaveBeenCalledWith("backend_cancel_request", {
      registrationId: "late-registration",
    });
    expect(invokeImplementation).not.toHaveBeenCalledWith(
      "backend_start_session",
      expect.anything(),
    );
  });
});
