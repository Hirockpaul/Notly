import { useCallback, useEffect, useRef, useState } from "react";

import { AudioChunkTransport } from "../services/audio-chunk-transport";
import { AudioBackendError } from "../services/audio-backend-client";
import type {
  AlignedTranscriptSegment,
  SpeechSessionResult,
  UtteranceError,
} from "../services/audio-backend-client";
import { getProgressStatus, normalizeTranscriptSegments } from "../services/transcript-progress";
import type { PcmAudioChunk } from "../types/audio";

const POLL_INTERVAL_MS = 750;

type IngestionStatus =
  "idle" | "starting" | "detecting" | "transcribing" | "processing" | "completed" | "error";

export function useAudioIngestion() {
  const [error, setError] = useState<AudioBackendError | null>(null);
  const [result, setResult] = useState<SpeechSessionResult | null>(null);
  const [segments, setSegments] = useState<AlignedTranscriptSegment[]>([]);
  const [utteranceErrors, setUtteranceErrors] = useState<UtteranceError[]>([]);
  const [pendingUtterances, setPendingUtterances] = useState(0);
  const [status, setStatus] = useState<IngestionStatus>("idle");
  const pollingTimer = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  const pollInFlight = useRef(false);
  const pollingEnabled = useRef(false);
  const [transport] = useState(
    () =>
      new AudioChunkTransport({
        onError: (transportError) => {
          setError(transportError);
          setStatus("error");
        },
      }),
  );

  const stopPolling = useCallback(() => {
    pollingEnabled.current = false;
    if (pollingTimer.current !== null) globalThis.clearInterval(pollingTimer.current);
    pollingTimer.current = null;
  }, []);

  const poll = useCallback(async () => {
    if (pollInFlight.current) return;
    pollInFlight.current = true;
    try {
      const snapshot = await transport.getProgress();
      if (!pollingEnabled.current) return;
      setSegments(normalizeTranscriptSegments(snapshot.transcript.segments));
      setUtteranceErrors(snapshot.errors);
      setPendingUtterances(snapshot.pendingUtterances);
      setStatus(getProgressStatus(snapshot));
    } catch {
      // Snapshots are reconnectable; a later successful poll catches up completely.
    } finally {
      pollInFlight.current = false;
    }
  }, [transport]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingEnabled.current = true;
    void poll();
    pollingTimer.current = globalThis.setInterval(() => void poll(), POLL_INTERVAL_MS);
  }, [poll, stopPolling]);

  const startSession = useCallback(
    async (languageCode: "en-US" | "hi-IN" = "en-US") => {
      setError(null);
      setResult(null);
      setSegments([]);
      setUtteranceErrors([]);
      setPendingUtterances(0);
      setStatus("starting");
      try {
        const sessionId = await transport.startSession(languageCode);
        setStatus("detecting");
        startPolling();
        return sessionId;
      } catch (startError) {
        const backendError = toBackendError(startError);
        setError(backendError);
        setStatus("error");
        throw backendError;
      }
    },
    [startPolling, transport],
  );

  const enqueue = useCallback((chunk: PcmAudioChunk) => transport.enqueue(chunk), [transport]);
  const pause = useCallback(() => transport.pause(), [transport]);
  const resume = useCallback(() => transport.resume(), [transport]);
  const finishSession = useCallback(async () => {
    stopPolling();
    setStatus("processing");
    try {
      const finalResult = await transport.finishSession();
      setResult(finalResult);
      setSegments(normalizeTranscriptSegments(finalResult.transcript.segments));
      setUtteranceErrors(finalResult.errors);
      setPendingUtterances(0);
      setStatus("completed");
      return finalResult;
    } catch (finishError) {
      const backendError = toBackendError(finishError);
      setError(backendError);
      setStatus("error");
      throw backendError;
    }
  }, [stopPolling, transport]);

  useEffect(
    () => () => {
      stopPolling();
      transport.dispose();
    },
    [stopPolling, transport],
  );

  return {
    enqueue,
    error,
    finishSession,
    pause,
    pendingUtterances,
    result,
    resume,
    segments,
    startSession,
    status,
    utteranceErrors,
  };
}

function toBackendError(error: unknown): AudioBackendError {
  return error instanceof AudioBackendError
    ? error
    : new AudioBackendError("unavailable", "The local audio backend failed unexpectedly.");
}
