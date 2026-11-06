import { invoke } from "@tauri-apps/api/core";

import type { PcmAudioChunk } from "../types/audio";

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_FINALIZE_TIMEOUT_MS = 200000;
const DEFAULT_NOTES_TIMEOUT_MS = 70000;
type InvokeImplementation = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type AudioBackendErrorCode =
  "unavailable" | "timeout" | "validation" | "cancelled" | "capacity";

export class AudioBackendError extends Error {
  readonly code: AudioBackendErrorCode;
  readonly status?: number;

  constructor(code: AudioBackendErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AudioBackendError";
    this.code = code;
    this.status = status;
  }
}

export interface AudioChunkAcknowledgement {
  received_bytes: number;
  sequence: number;
  session_id: string;
  status: "recording";
}

export interface SpeechSessionStart {
  sessionId: string;
  status: "recording";
  audioFormat: {
    encoding: "pcm_s16le";
    sampleRate: 16000;
    channels: 1;
  };
}

export interface AlignedTranscriptSegment {
  utterance_id: string;
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface SpeechSessionResult {
  sessionId: string;
  status: "completed" | "completed_with_errors";
  transcript: {
    session_id: string;
    segments: AlignedTranscriptSegment[];
  };
  errors: UtteranceError[];
}

export interface UtteranceError {
  utteranceId: string;
  message: string;
}

export interface SpeechSessionProgress {
  sessionId: string;
  status: "recording" | "processing" | "completed" | "completed_with_errors";
  transcript: SpeechSessionResult["transcript"];
  pendingUtterances: number;
  errors: UtteranceError[];
}

export interface NotesActionItem {
  task: string;
  owner: string | null;
  deadline: string | null;
}

export interface NotesDocument {
  title: string;
  summary: string | null;
  keyPoints: string[];
  actionItems: NotesActionItem[];
  importantInformation: string[];
  decisions: string[];
  additionalContext: string[];
}

export interface NotesGenerationResult {
  sessionId: string;
  status: "completed";
  notes: NotesDocument;
}

interface AudioBackendClientOptions {
  invokeImplementation?: InvokeImplementation;
  timeoutMs?: number;
}

export class AudioBackendClient {
  private readonly invokeImplementation: InvokeImplementation;
  private readonly timeoutMs: number;

  constructor({
    invokeImplementation = (command, args) => invoke(command, args),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: AudioBackendClientOptions = {}) {
    this.invokeImplementation = invokeImplementation;
    this.timeoutMs = timeoutMs;
  }

  async startSession(externalSignal?: AbortSignal): Promise<SpeechSessionStart> {
    return this.request<SpeechSessionStart>("backend_start_session", undefined, externalSignal);
  }

  async finishSession(
    sessionId: string,
    externalSignal?: AbortSignal,
  ): Promise<SpeechSessionResult> {
    return this.request<SpeechSessionResult>(
      "backend_finish_session",
      { sessionId },
      externalSignal,
      DEFAULT_FINALIZE_TIMEOUT_MS,
    );
  }

  async getSessionTranscript(
    sessionId: string,
    externalSignal?: AbortSignal,
  ): Promise<SpeechSessionProgress> {
    return this.request<SpeechSessionProgress>(
      "backend_get_transcript",
      { sessionId },
      externalSignal,
    );
  }

  async generateNotes(
    sessionId: string,
    regenerate = false,
    externalSignal?: AbortSignal,
  ): Promise<NotesGenerationResult> {
    return this.request<NotesGenerationResult>(
      "backend_generate_notes",
      { sessionId, regenerate },
      externalSignal,
      DEFAULT_NOTES_TIMEOUT_MS,
    );
  }

  async sendChunk(
    chunk: PcmAudioChunk,
    sessionId: string,
    externalSignal?: AbortSignal,
  ): Promise<AudioChunkAcknowledgement> {
    const bytes = new Uint8Array(chunk.data.byteLength);
    bytes.set(new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength));
    return this.request<AudioChunkAcknowledgement>(
      "backend_send_audio_chunk",
      {
        chunk: {
          bytes: Array.from(bytes),
          channels: 1,
          sampleRate: chunk.sampleRate,
          sequence: chunk.sequence,
          sessionId,
        },
      },
      externalSignal,
    );
  }

  private async request<T>(
    command: string,
    args: Record<string, unknown> | undefined,
    externalSignal?: AbortSignal,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    if (externalSignal?.aborted) {
      throw new AudioBackendError("cancelled", "The audio request was cancelled.");
    }
    const requestId = createRequestId();
    const requestController = new AbortController();
    let registrationId: string | undefined;
    let timedOut = false;
    const handleExternalAbort = () => requestController.abort();
    externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, timeoutMs);
    const cancelRustRequest = () => {
      if (registrationId !== undefined) {
        void this.invokeImplementation("backend_cancel_request", { registrationId }).catch(
          () => undefined,
        );
      }
    };
    requestController.signal.addEventListener("abort", cancelRustRequest, { once: true });
    const abortPromise = new Promise<never>((_resolve, reject) => {
      requestController.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
    const registrationPromise = this.invokeImplementation("backend_register_request", {
      requestId,
    }) as Promise<string>;
    try {
      registrationId = await Promise.race([registrationPromise, abortPromise]);
      if (typeof registrationId !== "string") {
        throw new Error("The local backend returned an invalid request registration.");
      }
      return await Promise.race([
        this.invokeImplementation(command, { ...args, requestId, registrationId }) as Promise<T>,
        abortPromise,
      ]);
    } catch (error) {
      if (error instanceof AudioBackendError) throw error;
      if (timedOut) {
        throw new AudioBackendError("timeout", "The local audio backend did not respond in time.");
      }
      if (externalSignal?.aborted) {
        throw new AudioBackendError("cancelled", "The audio request was cancelled.");
      }
      throw normalizeInvokeError(error, "The local audio backend is unavailable.");
    } finally {
      if (registrationId === undefined && requestController.signal.aborted) {
        void registrationPromise.then(
          (lateRegistrationId) =>
            this.invokeImplementation("backend_cancel_request", {
              registrationId: lateRegistrationId,
            }),
          () => undefined,
        );
      } else if (registrationId !== undefined) {
        void this.invokeImplementation("backend_cancel_request", { registrationId }).catch(
          () => undefined,
        );
      }
      globalThis.clearTimeout(timeout);
      requestController.signal.removeEventListener("abort", cancelRustRequest);
      externalSignal?.removeEventListener("abort", handleExternalAbort);
    }
  }
}

let requestSequence = 0;
function createRequestId(): string {
  requestSequence += 1;
  return `request-${crypto.randomUUID()}-${requestSequence}`;
}

function normalizeInvokeError(error: unknown, fallback: string): AudioBackendError {
  if (error instanceof AudioBackendError) return error;
  if (error && typeof error === "object") {
    const payload = error as { code?: unknown; message?: unknown; status?: unknown };
    if (typeof payload.code === "string" && typeof payload.message === "string") {
      const code: AudioBackendErrorCode =
        payload.code === "timeout"
          ? "timeout"
          : payload.code === "cancelled"
            ? "cancelled"
            : payload.code === "capacity"
              ? "capacity"
              : payload.code === "validation"
                ? "validation"
                : "unavailable";
      return new AudioBackendError(
        code,
        payload.message,
        typeof payload.status === "number" ? payload.status : undefined,
      );
    }
  }
  return new AudioBackendError("unavailable", fallback);
}
