import { useCallback, useEffect, useRef, useState } from "react";

import { AudioCaptureSession } from "../services/audio-capture";
import type {
  AudioInputDevice,
  MicrophoneError,
  MicrophoneStatus,
  PcmAudioChunk,
} from "../types/audio";
import { getAppPreferences, updateAppPreferences } from "../services/app-preferences";

interface UseMicrophoneOptions {
  onAudioChunk?: (chunk: PcmAudioChunk) => void;
}

export function useMicrophone({ onAudioChunk }: UseMicrophoneOptions = {}) {
  const [status, setStatus] = useState<MicrophoneStatus>("idle");
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState(
    () => getAppPreferences().microphoneDeviceId,
  );
  const [activeDeviceLabel, setActiveDeviceLabel] = useState("No microphone selected");
  const [audioLevel, setAudioLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<MicrophoneError | null>(null);

  const sessionRef = useRef<AudioCaptureSession | null>(null);
  const startingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeStartedAtRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const onAudioChunkRef = useRef(onAudioChunk);

  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    activeStartedAtRef.current = performance.now();
    stopTimer();
    intervalRef.current = setInterval(() => {
      setElapsedMs(accumulatedMsRef.current + performance.now() - activeStartedAtRef.current);
    }, 200);
  }, [stopTimer]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      const microphones = mediaDevices.filter((device) => device.kind === "audioinput");
      setDevices(
        microphones.map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        })),
      );
      setSelectedDeviceIdState((current) =>
        current === "default" || microphones.some((device) => device.deviceId === current)
          ? current
          : "default",
      );
    } catch {
      // Some WebViews restrict enumeration before permission; capture can still be requested.
    }
  }, []);

  const stop = useCallback(async () => {
    stopTimer();
    if (status === "recording") {
      accumulatedMsRef.current += performance.now() - activeStartedAtRef.current;
    }
    setElapsedMs(accumulatedMsRef.current);
    await sessionRef.current?.stop();
    sessionRef.current = null;
    startingRef.current = false;
    setAudioLevel(0);
    setStatus("stopped");
  }, [status, stopTimer]);

  const handleDeviceLost = useCallback(async () => {
    stopTimer();
    await sessionRef.current?.stop(false);
    sessionRef.current = null;
    setAudioLevel(0);
    setError({ code: "device-lost", message: "The active microphone was disconnected." });
    setStatus("error");
    await refreshDevices();
  }, [refreshDevices, stopTimer]);

  const start = useCallback(async () => {
    if (
      startingRef.current ||
      status === "requesting" ||
      status === "recording" ||
      status === "paused"
    ) {
      return false;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError({
        code: "unsupported",
        message: "Microphone access is unavailable in this WebView.",
      });
      setStatus("error");
      return false;
    }

    startingRef.current = true;
    setError(null);
    setStatus("requesting");
    accumulatedMsRef.current = 0;
    setElapsedMs(0);

    const session = new AudioCaptureSession({
      onChunk: (chunk) => onAudioChunkRef.current?.(chunk),
      onError: (captureError) => {
        setError({ code: "device-error", message: captureError.message });
        setStatus("error");
      },
      onLevel: setAudioLevel,
      onStreamEnded: () => void handleDeviceLost(),
    });
    sessionRef.current = session;

    try {
      const track = await session.start(selectedDeviceId, getAppPreferences().noiseReduction);
      setActiveDeviceLabel(track.label || "Active microphone");
      setStatus("recording");
      startTimer();
      await refreshDevices();
      return true;
    } catch (captureError) {
      sessionRef.current = null;
      setError(toMicrophoneError(captureError));
      setStatus("error");
      return false;
    } finally {
      startingRef.current = false;
    }
  }, [handleDeviceLost, refreshDevices, selectedDeviceId, startTimer, status]);

  const pause = useCallback(async () => {
    if (status !== "recording" || !sessionRef.current) return;
    accumulatedMsRef.current += performance.now() - activeStartedAtRef.current;
    stopTimer();
    await sessionRef.current.pause();
    setElapsedMs(accumulatedMsRef.current);
    setStatus("paused");
  }, [status, stopTimer]);

  const resume = useCallback(async () => {
    if (status !== "paused" || !sessionRef.current) return;
    await sessionRef.current.resume();
    setStatus("recording");
    startTimer();
  }, [startTimer, status]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices) return;
    const handleDeviceChange = () => void refreshDevices();
    const initialRefresh = window.setTimeout(handleDeviceChange, 0);
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      window.clearTimeout(initialRefresh);
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshDevices]);

  useEffect(() => {
    return () => {
      stopTimer();
      void sessionRef.current?.stop(false);
    };
  }, [stopTimer]);

  const setSelectedDeviceId = useCallback((deviceId: string) => {
    setSelectedDeviceIdState(deviceId);
    updateAppPreferences({ microphoneDeviceId: deviceId });
  }, []);

  return {
    activeDeviceLabel,
    audioLevel,
    devices,
    elapsedMs,
    error,
    pause,
    refreshDevices,
    resume,
    selectedDeviceId,
    setSelectedDeviceId,
    start,
    status,
    stop,
  };
}

function toMicrophoneError(error: unknown): MicrophoneError {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        code: "permission-denied",
        message: "Microphone permission was denied. Allow access in system settings and try again.",
      };
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return {
        code: "not-found",
        message: "The selected microphone is unavailable. Choose another input device.",
      };
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return { code: "device-error", message: "The microphone is busy or could not be opened." };
    }
  }
  return {
    code: "device-error",
    message: error instanceof Error ? error.message : "Microphone capture could not be started.",
  };
}
