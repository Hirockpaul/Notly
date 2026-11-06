import {
  AlertCircle,
  ChevronDown,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  ShieldCheck,
  Square,
} from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { NotesPanel } from "../notes/NotesPanel";
import type { NotesUiStatus } from "../notes/NotesPanel";
import { useAudioIngestion } from "../../hooks/useAudioIngestion";
import { useMicrophone } from "../../hooks/useMicrophone";
import { AudioBackendClient } from "../../services/audio-backend-client";
import type { NotesDocument } from "../../services/audio-backend-client";
import { saveCompletedSession, saveGeneratedNotes } from "../../services/session-storage";
import type { SavedSession } from "../../services/session-storage";

const waveHeights = [
  20, 34, 48, 72, 38, 56, 26, 64, 84, 52, 30, 74, 46, 68, 24, 58, 80, 36, 62, 44, 28, 70, 50, 32,
  60, 22,
];

export function RecordingPage() {
  const ingestion = useAudioIngestion();
  const [notesClient] = useState(() => new AudioBackendClient());
  const [activeView, setActiveView] = useState<"transcript" | "notes">("transcript");
  const [notes, setNotes] = useState<NotesDocument | null>(null);
  const [notesStatus, setNotesStatus] = useState<NotesUiStatus>("idle");
  const [notesError, setNotesError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);
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
      setActiveView("transcript");
      setNotes(null);
      setNotesError(null);
      setStorageError(null);
      setNotesStatus("idle");
      setSavedSession(null);
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
      const result = await ingestion.finishSession();
      try {
        setSavedSession(await saveCompletedSession(result));
      } catch (saveError) {
        setStorageError(
          saveError instanceof Error
            ? saveError.message
            : typeof saveError === "string"
              ? saveError
              : "The completed recording was not saved.",
        );
      }
    } catch {
      // The ingestion hook exposes recording and backend errors.
    }
  };

  const handleGenerateNotes = async (regenerate: boolean) => {
    if (!ingestion.result || ingestion.result.transcript.segments.length === 0) return;
    setNotesError(null);
    setNotesStatus(regenerate ? "regenerating" : "generating");
    try {
      const generated = await notesClient.generateNotes(ingestion.result.sessionId, regenerate);
      setNotes(generated.notes);
      setNotesStatus("generated");
      try {
        await saveGeneratedNotes(ingestion.result.sessionId, generated.notes);
      } catch (saveError) {
        setStorageError(
          saveError instanceof Error
            ? saveError.message
            : typeof saveError === "string"
              ? saveError
              : "The generated notes were not saved.",
        );
      }
    } catch (generationError) {
      setNotesError(
        generationError instanceof Error
          ? generationError.message
          : "Notes generation failed unexpectedly.",
      );
      setNotesStatus("error");
    }
  };

  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-7 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[#737373]">Live session</span>
          <h1 className="mt-2 text-[clamp(28px,3vw,32px)] leading-tight font-semibold tracking-[-0.03em]">
            Recording
          </h1>
          <p className="mt-2.5 text-sm text-[#A3A3A3]">
            Capture microphone audio privately on this device.
          </p>
        </div>
        <Button aria-label="More recording options" size="icon" variant="secondary">
          <MoreHorizontal size={18} />
        </Button>
      </header>

      <Card className="grid grid-cols-[auto_minmax(150px,.55fr)_minmax(240px,1fr)_auto] items-center gap-6 p-6">
        <div
          className={`flex size-11 items-center justify-center rounded-[10px] border ${isRecording ? "border-[#EF4444]/40 bg-[#EF4444]/10 text-[#EF4444]" : "border-[#383838] bg-[#303030] text-[#A3A3A3]"}`}
        >
          {isStopped ? <Square fill="currentColor" size={23} /> : <Mic2 size={25} />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-[#A3A3A3]">
            <span
              className={`size-[7px] rounded-full ${isRecording ? "animate-pulse bg-[#EF4444]" : "bg-[#555555]"}`}
            />
            {statusLabel}
          </div>
          <strong className="mt-1 block text-xl tracking-tight">
            {formatElapsedTime(elapsedMs)}
          </strong>
          <span className="mt-1 block truncate text-[10px] text-[#737373]">
            {isActive ? activeDeviceLabel : "Microphone access starts only when you press Start"}
          </span>
        </div>
        <div
          className={`flex h-18 items-center justify-center gap-1 overflow-hidden ${!isRecording ? "opacity-30" : ""}`}
          aria-label={isRecording ? "Live microphone activity" : "Microphone activity idle"}
        >
          {waveHeights.map((height, index) => (
            <span
              className={`w-[3px] rounded-full transition-[height] duration-150 ${isRecording ? "bg-[#F5F5F5]" : "bg-[#737373]"}`}
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
        <label className="flex items-center gap-3 text-xs text-[#737373]">
          <span>Input device</span>
          <div className="relative">
            <select
              className="appearance-none rounded-md border border-[#383838] bg-[#343434] py-2 pr-8 pl-3 text-xs text-[#F5F5F5] outline-none transition-colors focus:border-[#3B82F6]"
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
        <div className="flex items-center gap-2 text-xs text-[#737373]">
          <ShieldCheck size={15} />
          <span>
            Solo Mode uploads detected speech to NVIDIA when hosted transcription is enabled.
          </span>
        </div>
      </div>

      {error ? (
        <div
          className="mt-4 flex items-center gap-3 rounded-[10px] border border-[#EF4444]/30 bg-[#EF4444]/10 p-4 text-[#EF4444]"
          role="alert"
        >
          <AlertCircle size={17} />
          <div>
            <strong className="text-xs">Microphone unavailable</strong>
            <p className="mt-1 text-[10px] text-[#EF4444]/80">{error.message}</p>
          </div>
          <Button onClick={() => void handleStart()} size="small" variant="secondary">
            Try again
          </Button>
        </div>
      ) : null}

      {ingestion.error ? (
        <div
          className="mt-4 flex items-center gap-3 rounded-[10px] border border-[#EF4444]/30 bg-[#EF4444]/10 p-4 text-[#EF4444]"
          role="alert"
        >
          <AlertCircle size={17} />
          <div>
            <strong className="text-xs">Local backend connection error</strong>
            <p className="mt-1 text-[10px] text-[#EF4444]/80">{ingestion.error.message}</p>
          </div>
        </div>
      ) : null}

      {storageError ? (
        <div
          className="mt-4 flex items-center gap-3 rounded-[10px] border border-[#EF4444]/30 bg-[#EF4444]/10 p-4 text-[#EF4444]"
          role="alert"
        >
          <AlertCircle size={17} />
          <div>
            <strong className="text-xs">Local storage error</strong>
            <p className="mt-1 text-[10px] text-[#EF4444]/80">{storageError}</p>
          </div>
        </div>
      ) : null}

      {ingestion.utteranceErrors.length > 0 ? (
        <div
          className="mt-4 rounded-[10px] border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-4 text-[#F59E0B]"
          role="alert"
        >
          <strong className="text-xs">Some speech could not be transcribed</strong>
          <ul className="mt-2 grid gap-1 text-[10px] text-[#F59E0B]/80">
            {ingestion.utteranceErrors.map((utteranceError) => (
              <li key={utteranceError.utteranceId}>{utteranceError.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex gap-2" aria-label="Session view">
        <Button
          aria-pressed={activeView === "transcript"}
          onClick={() => setActiveView("transcript")}
          size="small"
          variant={activeView === "transcript" ? "primary" : "secondary"}
        >
          Transcript
        </Button>
        <Button
          aria-pressed={activeView === "notes"}
          onClick={() => setActiveView("notes")}
          size="small"
          variant={activeView === "notes" ? "primary" : "secondary"}
        >
          AI Notes
        </Button>
      </div>

      <div className="mt-3">
        {activeView === "transcript" ? (
          <Card className="min-h-90 p-6">
            <SectionHeader
              action={
                <span className="rounded-full border border-[#383838] px-2 py-1 text-[10px] text-[#A3A3A3]">
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
                  className="grid grid-cols-[34px_1fr] gap-3 border-t border-[#303030] py-4 first:border-t-0"
                  key={segment.utterance_id}
                >
                  <div className="flex size-8.5 items-center justify-center rounded-full bg-[#343434] text-[11px] font-bold text-[#F5F5F5]">
                    {segment.speaker.charAt(0) || "?"}
                  </div>
                  <div>
                    <header className="flex items-center justify-between">
                      <strong className="text-xs">{segment.speaker}</strong>
                      <span className="text-[10px] text-[#737373]">
                        {formatTimestamp(segment.start)}
                      </span>
                    </header>
                    <p className="mt-1.5 text-xs leading-6 text-[#A3A3A3]">{segment.text}</p>
                  </div>
                </article>
              ))}
              {segments.length === 0 ? (
                <p className="py-12 text-center text-xs text-[#737373]">
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
        ) : (
          <Card className="min-h-90 p-6">
            <NotesPanel
              canGenerate={
                ingestion.status === "completed" &&
                (ingestion.result?.transcript.segments.length ?? 0) > 0
              }
              error={notesError}
              delivery={
                savedSession
                  ? {
                      title: savedSession.title,
                      createdAt: savedSession.createdAt,
                      durationSeconds: savedSession.durationSeconds,
                    }
                  : undefined
              }
              notes={notes}
              onGenerate={(regenerate) => void handleGenerateNotes(regenerate)}
              status={notesStatus}
            />
          </Card>
        )}
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
