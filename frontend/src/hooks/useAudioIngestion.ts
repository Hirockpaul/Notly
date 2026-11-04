import { useCallback, useEffect, useState } from "react";

import { AudioChunkTransport } from "../services/audio-chunk-transport";
import { AudioBackendError } from "../services/audio-backend-client";
import type { SpeechSessionResult } from "../services/audio-backend-client";
import type { PcmAudioChunk } from "../types/audio";

export function useAudioIngestion() {
  const [error, setError] = useState<AudioBackendError | null>(null);
  const [result, setResult] = useState<SpeechSessionResult | null>(null);
  const [status, setStatus] = useState<
    "idle" | "starting" | "recording" | "processing" | "completed" | "error"
  >("idle");
  const [transport] = useState(
    () =>
      new AudioChunkTransport({
        onError: setError,
      }),
  );

  const startSession = useCallback(async () => {
    setError(null);
    setResult(null);
    setStatus("starting");
    try {
      const sessionId = await transport.startSession();
      setStatus("recording");
      return sessionId;
    } catch (startError) {
      const backendError = toBackendError(startError);
      setError(backendError);
      setStatus("error");
      throw backendError;
    }
  }, [transport]);

  const enqueue = useCallback((chunk: PcmAudioChunk) => transport.enqueue(chunk), [transport]);
  const pause = useCallback(() => transport.pause(), [transport]);
  const resume = useCallback(() => transport.resume(), [transport]);
  const finishSession = useCallback(async () => {
    setStatus("processing");
    try {
      const finalResult = await transport.finishSession();
      setResult(finalResult);
      setStatus("completed");
      return finalResult;
    } catch (finishError) {
      const backendError = toBackendError(finishError);
      setError(backendError);
      setStatus("error");
      throw backendError;
    }
  }, [transport]);

  useEffect(() => () => transport.dispose(), [transport]);

  return { enqueue, error, finishSession, pause, result, resume, startSession, status };
}

function toBackendError(error: unknown): AudioBackendError {
  return error instanceof AudioBackendError
    ? error
    : new AudioBackendError("unavailable", "The local audio backend failed unexpectedly.");
}
