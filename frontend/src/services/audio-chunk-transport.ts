import type { PcmAudioChunk } from "../types/audio";
import { AudioBackendClient, AudioBackendError } from "./audio-backend-client";
import type { SpeechSessionProgress, SpeechSessionResult } from "./audio-backend-client";

const MAX_QUEUED_CHUNKS = 4;

interface AudioChunkTransportOptions {
  client?: AudioBackendClient;
  maxQueuedChunks?: number;
  onError: (error: AudioBackendError) => void;
}

export class AudioChunkTransport {
  private readonly client: AudioBackendClient;
  private readonly maxQueuedChunks: number;
  private readonly onError: (error: AudioBackendError) => void;
  private readonly queue: PcmAudioChunk[] = [];
  private sessionId: string | null = null;
  private requestController: AbortController | null = null;
  private accepting = false;
  private processing = false;
  private failed = false;
  private drainPromise: Promise<void> | null = null;

  constructor({
    client = new AudioBackendClient(),
    maxQueuedChunks = MAX_QUEUED_CHUNKS,
    onError,
  }: AudioChunkTransportOptions) {
    this.client = client;
    this.maxQueuedChunks = maxQueuedChunks;
    this.onError = onError;
  }

  async startSession(): Promise<string> {
    this.dispose();
    const started = await this.client.startSession();
    this.sessionId = started.sessionId;
    this.accepting = true;
    this.failed = false;
    return this.sessionId;
  }

  enqueue(chunk: PcmAudioChunk): void {
    if (!this.accepting || !this.sessionId || this.failed) return;
    if (this.queue.length >= this.maxQueuedChunks) {
      this.fail(
        new AudioBackendError(
          "unavailable",
          "The local backend is too slow. Audio transport stopped to prevent memory growth.",
        ),
      );
      return;
    }
    this.queue.push(chunk);
    this.drainPromise ??= this.drain();
  }

  pause(): void {
    this.accepting = false;
  }

  resume(): void {
    if (this.sessionId && !this.failed) this.accepting = true;
  }

  async getProgress(): Promise<SpeechSessionProgress> {
    if (!this.sessionId) {
      throw new AudioBackendError("unavailable", "There is no active audio session.");
    }
    return this.client.getSessionTranscript(this.sessionId);
  }

  async finishSession(): Promise<SpeechSessionResult> {
    this.accepting = false;
    await (this.drainPromise ?? this.drain());
    if (this.failed || !this.sessionId) {
      throw new AudioBackendError("unavailable", "The audio session could not be finalized.");
    }
    const result = await this.client.finishSession(this.sessionId);
    this.sessionId = null;
    return result;
  }

  dispose(): void {
    this.accepting = false;
    this.queue.length = 0;
    this.requestController?.abort();
    this.requestController = null;
    this.sessionId = null;
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.sessionId && this.queue.length > 0) {
        const chunk = this.queue.shift();
        if (!chunk) break;
        this.requestController = new AbortController();
        try {
          await this.client.sendChunk(chunk, this.sessionId, this.requestController.signal);
        } catch (error) {
          if (error instanceof AudioBackendError && error.code === "cancelled") {
            break;
          }
          this.fail(
            error instanceof AudioBackendError
              ? error
              : new AudioBackendError("unavailable", "Audio transport failed unexpectedly."),
          );
        } finally {
          this.requestController = null;
        }
      }
    } finally {
      this.processing = false;
      this.drainPromise = null;
    }
  }

  private fail(error: AudioBackendError): void {
    if (this.failed) return;
    this.failed = true;
    this.accepting = false;
    this.queue.length = 0;
    this.requestController?.abort();
    this.onError(error);
  }
}
