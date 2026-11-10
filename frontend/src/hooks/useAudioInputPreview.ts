import { useCallback, useEffect, useRef, useState } from "react";

import type { AudioInputDevice } from "../types/audio";

export function useAudioInputPreview(deviceId: string, noiseReduction: boolean) {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<() => void>(() => undefined);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const available = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    setDevices(
      available.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      })),
    );
  }, []);

  const stopPreview = useCallback(() => {
    cleanupRef.current();
    cleanupRef.current = () => undefined;
    setLevel(0);
  }, []);

  const startPreview = useCallback(async () => {
    stopPreview();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId !== "default" ? { exact: deviceId } : undefined,
          echoCancellation: noiseReduction,
          noiseSuppression: noiseReduction,
        },
      });
      const context = new AudioContext({ latencyHint: "interactive" });
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const update = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
        frame = requestAnimationFrame(update);
      };
      frame = requestAnimationFrame(update);
      cleanupRef.current = () => {
        cancelAnimationFrame(frame);
        source.disconnect();
        analyser.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
      };
      await refreshDevices();
    } catch (previewError) {
      setError(
        previewError instanceof Error ? previewError.message : "Microphone preview is unavailable.",
      );
    }
  }, [deviceId, noiseReduction, refreshDevices, stopPreview]);

  useEffect(() => stopPreview, [stopPreview]);

  return { devices, error, level, refreshDevices, startPreview, stopPreview };
}
