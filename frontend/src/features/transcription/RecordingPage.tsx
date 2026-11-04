import {
  AlertCircle,
  Check,
  ChevronDown,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  ShieldCheck,
  Square,
} from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { useAudioIngestion } from "../../hooks/useAudioIngestion";
import { useMicrophone } from "../../hooks/useMicrophone";

const waveHeights = [
  20, 34, 48, 72, 38, 56, 26, 64, 84, 52, 30, 74, 46, 68, 24, 58, 80, 36, 62, 44, 28, 70, 50, 32,
  60, 22,
];

export function RecordingPage() {
  const ingestion = useAudioIngestion();
  const {
    activeDeviceLabel,
    audioLevel,
    devices,
    elapsedMs,
    error,
    pause,
    resume,
    selectedDeviceId,
    setSelectedDeviceId,
    start,
    status,
    stop,
  } = useMicrophone({ onAudioChunk: ingestion.enqueue });

  const isStopped = status === "stopped";
  const isPaused = status === "paused";
  const isRecording = status === "recording";
  const isRequesting = status === "requesting";
  const isActive = isRecording || isPaused;
  const isBusy = ingestion.status === "starting" || ingestion.status === "processing";
  const segments = ingestion.segments;
  const statusLabel =
    ingestion.status === "starting"
      ? "Starting local session"
      : ingestion.status === "processing"
        ? "Processing final audio"
        : ingestion.status === "transcribing"
          ? `Transcribing ${ingestion.pendingUtterances} utterance${ingestion.pendingUtterances === 1 ? "" : "s"}`
          : ingestion.status === "detecting"
            ? "Detecting speech"
            : ingestion.status === "completed"
              ? ingestion.utteranceErrors.length > 0
                ? "Completed with transcription errors"
                : "Session completed"
              : getStatusLabel(status);

  const handleStart = async () => {
    try {
      await ingestion.startSession();
      const microphoneStarted = await start();
      if (!microphoneStarted) await ingestion.finishSession();
    } catch {
      // Both hooks expose a user-facing error state.
    }
  };

  const handleStop = async () => {
    try {
      // Stopping capture emits its final partial PCM chunk synchronously before resolving.
      await stop();
      await ingestion.finishSession();
    } catch {
      // The ingestion hook exposes a user-facing error state.
    }
  };

  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-7 flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
            Live session
          </span>
          <h1 className="mt-2 text-[clamp(29px,3vw,38px)] leading-tight font-semibold tracking-[-0.045em]">
            Recording
          </h1>
          <p className="mt-2.5 text-sm text-[#9298a7]">
            Capture microphone audio privately on this device.
          </p>
        </div>
        <Button aria-label="More recording options" size="icon" variant="secondary">
          <MoreHorizontal size={18} />
        </Button>
      </header>

      <Card className="grid grid-cols-[auto_minmax(150px,.55fr)_minmax(240px,1fr)_auto] items-center gap-6 p-6">
        <div
          className={`flex size-12 items-center justify-center rounded-full border ${isRecording ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-[#252936] bg-white/4 text-[#9298a7]"}`}
        >
          {isStopped ? <Square fill="currentColor" size={23} /> : <Mic2 size={25} />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-[#9298a7]">
            <span
              className={`size-[7px] rounded-full ${isRecording ? "animate-pulse bg-red-400 shadow-[0_0_0_4px_rgb(248_113_113/10%)]" : "bg-[#59606f]"}`}
            />
            {statusLabel}
          </div>
          <strong className="mt-1 block text-xl tracking-tight">
            {formatElapsedTime(elapsedMs)}
          </strong>
          <span className="mt-1 block truncate text-[10px] text-[#686f80]">
            {isActive ? activeDeviceLabel : "Microphone access starts only when you press Start"}
          </span>
        </div>
        <div
          className={`flex h-18 items-center justify-center gap-1 overflow-hidden ${!isRecording ? "opacity-30" : ""}`}
          aria-label={isRecording ? "Live microphone activity" : "Microphone activity idle"}
        >
          {waveHeights.map((height, index) => (
            <span
              className="w-[3px] rounded-full bg-indigo-400 transition-[height] duration-100"
              key={index}
              style={{ height: `${Math.max(6, height * (0.2 + audioLevel * 1.5))}%` }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {isActive ? (
            <>
              <Button
                aria-label={isPaused ? "Resume recording" : "Pause recording"}
                onClick={() => {
                  if (isPaused) {
                    void resume().then(ingestion.resume);
                  } else {
                    ingestion.pause();
                    void pause();
                  }
                }}
                size="icon"
                variant="secondary"
              >
                {isPaused ? (
                  <Play fill="currentColor" size={17} />
                ) : (
                  <Pause fill="currentColor" size={17} />
                )}
              </Button>
              <Button disabled={isBusy} onClick={() => void handleStop()} variant="danger">
                <Square fill="currentColor" size={13} /> Stop recording
              </Button>
            </>
          ) : (
            <Button disabled={isRequesting || isBusy} onClick={() => void handleStart()}>
              <Mic2 size={15} />{" "}
              {isBusy
                ? "Please wait..."
                : isRequesting
                  ? "Requesting access..."
                  : "Start recording"}
            </Button>
          )}
        </div>
      </Card>

      <div className="mt-3 flex items-center justify-between gap-5">
        <label className="flex items-center gap-3 text-[10px] text-[#686f80]">
          <span>Input device</span>
          <div className="relative">
            <select
              className="appearance-none rounded-lg border border-[#252936] bg-[#0d0f14] py-2 pr-8 pl-3 text-[11px] text-[#9298a7] outline-none focus:border-indigo-400/60"
              disabled={isActive || isRequesting}
              onChange={(event) => setSelectedDeviceId(event.target.value)}
              value={selectedDeviceId}
            >
              <option value="default">System default microphone</option>
              {devices
                .filter((device) => device.deviceId !== "default")
                .map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"
              size={14}
            />
          </div>
        </label>
        <div className="flex items-center gap-2 text-[10px] text-[#686f80]">
          <ShieldCheck size={15} />
          <span>
            Solo Mode uploads detected speech to NVIDIA when hosted transcription is enabled.
          </span>
        </div>
      </div>

      {error ? (
        <div
          className="mt-4 flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-red-200"
          role="alert"
        >
          <AlertCircle size={17} />
          <div>
            <strong className="text-xs">Microphone unavailable</strong>
            <p className="mt-1 text-[10px] text-red-200/70">{error.message}</p>
          </div>
          <Button onClick={() => void handleStart()} size="small" variant="secondary">
            Try again
          </Button>
        </div>
      ) : null}

      {ingestion.error ? (
        <div
          className="mt-4 flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-400/10 p-4 text-red-200"
          role="alert"
        >
          <AlertCircle size={17} />
          <div>
            <strong className="text-xs">Local backend connection error</strong>
            <p className="mt-1 text-[10px] text-red-200/70">{ingestion.error.message}</p>
          </div>
        </div>
      ) : null}

      {ingestion.utteranceErrors.length > 0 ? (
        <div
          className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-amber-100"
          role="alert"
        >
          <strong className="text-xs">Some speech could not be transcribed</strong>
          <ul className="mt-2 grid gap-1 text-[10px] text-amber-100/70">
            {ingestion.utteranceErrors.map((utteranceError) => (
              <li key={utteranceError.utteranceId}>{utteranceError.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-[minmax(0,1.5fr)_minmax(260px,.7fr)] gap-4">
        <Card className="min-h-90 p-6">
          <SectionHeader
            action={
              <span className="rounded-full border border-[#252936] px-2 py-1 text-[10px] text-[#9298a7]">
                Solo mode
              </span>
            }
            description={
              ingestion.status === "processing"
                ? "Finalizing the local speech pipeline..."
                : ingestion.status === "completed"
                  ? "Final timestamp-aligned pipeline result"
                  : "Completed utterances appear here while you continue recording"
            }
            title="Your transcript"
          />
          <div className="mt-5 grid gap-1">
            {segments.map((segment) => (
              <article
                className="grid grid-cols-[34px_1fr] gap-3 border-t border-[#1d2029] py-4 first:border-t-0"
                key={segment.utterance_id}
              >
                <div className="flex size-8.5 items-center justify-center rounded-full bg-indigo-400/10 text-[11px] font-bold text-indigo-300">
                  {segment.speaker.charAt(0) || "?"}
                </div>
                <div>
                  <header className="flex items-center justify-between">
                    <strong className="text-xs">{segment.speaker}</strong>
                    <span className="text-[10px] text-[#686f80]">
                      {formatTimestamp(segment.start)}
                    </span>
                  </header>
                  <p className="mt-1.5 text-xs leading-6 text-[#9298a7]">{segment.text}</p>
                </div>
              </article>
            ))}
            {segments.length === 0 ? (
              <p className="py-12 text-center text-xs text-[#686f80]">
                {ingestion.status === "completed"
                  ? "No speech utterances were detected in this session."
                  : ingestion.status === "processing"
                    ? "Processing final audio..."
                    : ingestion.status === "transcribing"
                      ? "Transcribing completed speech..."
                      : "Listening for completed speech..."}
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="flex min-h-90 flex-col p-6">
          <SectionHeader
            description="Available after note analysis is implemented"
            title="Important points"
          />
          <div className="mt-5">
            <div className="grid grid-cols-[24px_1fr] gap-2 border-t border-[#1d2029] py-3">
              <span className="flex size-5 items-center justify-center rounded-full bg-indigo-400/10 text-indigo-300">
                <Check size={13} />
              </span>
              <p className="text-[11px] leading-5 text-[#9298a7]">
                No important points have been generated for this session.
              </p>
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-[#1d2029] pt-4 text-[10px] text-[#686f80]">
            <span className="flex items-center gap-2">
              <span className="size-[7px] rounded-full bg-[#59606f]" /> Analysis unavailable
            </span>
            <small>Transcript only</small>
          </div>
        </Card>
      </div>
    </div>
  );
}

function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function getStatusLabel(status: ReturnType<typeof useMicrophone>["status"]): string {
  const labels = {
    error: "Microphone error",
    idle: "Ready to record",
    paused: "Recording paused",
    recording: "Listening now",
    requesting: "Waiting for permission",
    stopped: "Session ended",
  } as const;
  return labels[status];
}
