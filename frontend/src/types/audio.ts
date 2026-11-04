export type MicrophoneStatus = "idle" | "requesting" | "recording" | "paused" | "stopped" | "error";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface PcmAudioChunk {
  data: Int16Array;
  sampleRate: 16000;
  sequence: number;
  durationMs: number;
}

export interface AudioCaptureHandlers {
  onChunk: (chunk: PcmAudioChunk) => void;
  onError: (error: Error) => void;
  onLevel: (level: number) => void;
  onStreamEnded: () => void;
}

export interface MicrophoneError {
  code: "unsupported" | "permission-denied" | "not-found" | "device-lost" | "device-error";
  message: string;
}
