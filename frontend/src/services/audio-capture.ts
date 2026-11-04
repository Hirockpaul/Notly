import type { AudioCaptureHandlers, PcmAudioChunk } from "../types/audio";
import { float32ToPcm16, resampleAudio } from "./audio-resampler";

const TARGET_SAMPLE_RATE = 16000 as const;
const CHUNK_DURATION_MS = 500;
const CHUNK_SAMPLE_COUNT = (TARGET_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000;

export class AudioCaptureSession {
  private readonly handlers: AudioCaptureHandlers;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentGainNode: GainNode | null = null;
  private pendingSamples: number[] = [];
  private sequence = 0;
  private paused = false;
  private stopping = false;

  constructor(handlers: AudioCaptureHandlers) {
    this.handlers = handlers;
  }

  async start(deviceId?: string): Promise<MediaStreamTrack> {
    if (this.stream) throw new Error("An audio capture session is already active.");
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not supported by this WebView.");
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          deviceId: deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: { ideal: TARGET_SAMPLE_RATE },
        },
        video: false,
      });

      this.audioContext = new AudioContext({ latencyHint: "interactive" });
      this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.silentGainNode = this.audioContext.createGain();
      this.silentGainNode.gain.value = 0;

      this.processorNode.onaudioprocess = (event) => {
        if (this.paused || this.stopping) return;

        const input = event.inputBuffer.getChannelData(0);
        this.handlers.onLevel(calculateAudioLevel(input));
        const resampled = resampleAudio(input, event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE);
        for (const sample of resampled) this.pendingSamples.push(sample);
        this.emitCompleteChunks();
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.silentGainNode);
      this.silentGainNode.connect(this.audioContext.destination);

      const track = this.stream.getAudioTracks()[0];
      if (!track) throw new Error("No audio track was provided by the selected microphone.");
      track.addEventListener("ended", this.handleTrackEnded);
      return track;
    } catch (error) {
      await this.stop(false);
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (!this.audioContext || this.paused) return;
    this.paused = true;
    this.handlers.onLevel(0);
    await this.audioContext.suspend();
  }

  async resume(): Promise<void> {
    if (!this.audioContext || !this.paused) return;
    await this.audioContext.resume();
    this.paused = false;
  }

  async stop(emitFinalChunk = true): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    if (emitFinalChunk && this.pendingSamples.length > 0) this.emitFinalChunk();
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.silentGainNode?.disconnect();
    if (this.processorNode) this.processorNode.onaudioprocess = null;

    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener("ended", this.handleTrackEnded);
      track.stop();
    }
    if (this.audioContext && this.audioContext.state !== "closed") await this.audioContext.close();

    this.handlers.onLevel(0);
    this.audioContext = null;
    this.stream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.silentGainNode = null;
    this.pendingSamples = [];
    this.paused = false;
    this.stopping = false;
  }

  private readonly handleTrackEnded = () => {
    if (!this.stopping) this.handlers.onStreamEnded();
  };

  private emitCompleteChunks(): void {
    while (this.pendingSamples.length >= CHUNK_SAMPLE_COUNT) {
      const samples = new Float32Array(this.pendingSamples.splice(0, CHUNK_SAMPLE_COUNT));
      this.emitChunk(samples, CHUNK_DURATION_MS);
    }
  }

  private emitFinalChunk(): void {
    const samples = new Float32Array(this.pendingSamples.splice(0));
    this.emitChunk(samples, (samples.length / TARGET_SAMPLE_RATE) * 1000);
  }

  private emitChunk(samples: Float32Array, durationMs: number): void {
    const chunk: PcmAudioChunk = {
      data: float32ToPcm16(samples),
      durationMs,
      sampleRate: TARGET_SAMPLE_RATE,
      sequence: this.sequence,
    };
    this.sequence += 1;
    this.handlers.onChunk(chunk);
  }
}

function calculateAudioLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumOfSquares = 0;
  for (const sample of samples) sumOfSquares += sample * sample;
  return Math.min(1, Math.sqrt(sumOfSquares / samples.length) * 4);
}
