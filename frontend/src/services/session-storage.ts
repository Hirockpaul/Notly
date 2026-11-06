import { invoke } from "@tauri-apps/api/core";

import type { NotesDocument, SpeechSessionResult } from "./audio-backend-client";

export const LEGACY_STORAGE_KEY = "noto.completed-sessions.v1";
const BROWSER_STORAGE_KEY = "noto.browser-development-sessions.v2";
const MAX_BROWSER_SESSIONS = 50;

export interface SavedSession {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number;
  transcriptStatus: string;
  transcript: SpeechSessionResult["transcript"];
  notesStatus: "not_generated" | "generated";
  notes: NotesDocument | null;
}

export interface StorageStatistics {
  storageMode: "sqlite" | "browser-development";
  totalRecordings: number;
  totalNotes: number;
  databaseSizeBytes: number;
  integrity: string;
}

interface MigrationResult {
  imported: number;
  skippedExisting: number;
  migrationRecorded: boolean;
}

interface SessionInput {
  sessionId: string;
  title: string;
  createdAt: string;
  durationSeconds: number;
  transcriptStatus: string;
  transcript: SpeechSessionResult["transcript"];
  notes: NotesDocument | null;
}

export function isTauriStorage(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function initializeSessionStorage(storage: Storage = localStorage): Promise<void> {
  const raw = storage.getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return;

  const legacy = parseLegacySessions(raw);
  if (!isTauriStorage()) {
    if (storage.getItem(BROWSER_STORAGE_KEY) === null) {
      writeBrowserSessions(legacy.map(toSavedSession), storage);
    }
    return;
  }
  const result = await invoke<MigrationResult>("migrate_legacy_sessions", { sessions: legacy });
  const expectedRecords = legacy.length;
  if (!result.migrationRecorded || result.imported + result.skippedExisting !== expectedRecords) {
    throw new Error("Legacy data was not fully verified. The original browser data was preserved.");
  }
  const confirmed = await invoke<boolean>("confirm_legacy_migration", { expectedRecords });
  if (!confirmed) {
    throw new Error(
      "Legacy migration verification failed. The original browser data was preserved.",
    );
  }
  storage.removeItem(LEGACY_STORAGE_KEY);
}

export async function listSavedSessions(storage: Storage = localStorage): Promise<SavedSession[]> {
  if (isTauriStorage()) return invoke<SavedSession[]>("get_completed_sessions");
  return readBrowserSessions(storage);
}

export async function getSavedSession(
  sessionId: string,
  storage: Storage = localStorage,
): Promise<SavedSession | null> {
  if (isTauriStorage()) return invoke<SavedSession | null>("get_completed_session", { sessionId });
  return readBrowserSessions(storage).find((session) => session.sessionId === sessionId) ?? null;
}

export async function saveCompletedSession(
  result: SpeechSessionResult,
  storage: Storage = localStorage,
): Promise<SavedSession> {
  const existing = await getSavedSession(result.sessionId, storage);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const input: SessionInput = {
    sessionId: result.sessionId,
    title: existing?.title ?? "Untitled recording",
    createdAt,
    durationSeconds: result.transcript.segments.at(-1)?.end ?? 0,
    transcriptStatus: result.status,
    transcript: result.transcript,
    notes: existing?.notes ?? null,
  };
  if (isTauriStorage()) {
    await invoke("save_completed_session", { session: input });
    const saved = await getSavedSession(result.sessionId, storage);
    if (!saved) throw new Error("The completed recording could not be verified after saving.");
    return saved;
  }
  const saved = toSavedSession(input);
  writeBrowserSessions(
    [saved, ...readBrowserSessions(storage).filter((item) => item.sessionId !== result.sessionId)],
    storage,
  );
  return saved;
}

export async function saveGeneratedNotes(
  sessionId: string,
  notes: NotesDocument,
  storage: Storage = localStorage,
): Promise<void> {
  if (isTauriStorage()) {
    await invoke("save_generated_notes", { sessionId, notes });
    return;
  }
  const sessions = readBrowserSessions(storage);
  writeBrowserSessions(
    sessions.map((session) =>
      session.sessionId === sessionId
        ? {
            ...session,
            notes,
            notesStatus: "generated" as const,
            updatedAt: new Date().toISOString(),
          }
        : session,
    ),
    storage,
  );
}

export async function updateSessionTitle(
  sessionId: string,
  title: string,
  storage: Storage = localStorage,
): Promise<boolean> {
  if (isTauriStorage()) return invoke<boolean>("update_session_title", { sessionId, title });
  const normalized = title.trim();
  if (!normalized || normalized.length > 200)
    throw new Error("Enter a title up to 200 characters.");
  const sessions = readBrowserSessions(storage);
  const found = sessions.some((session) => session.sessionId === sessionId);
  writeBrowserSessions(
    sessions.map((session) =>
      session.sessionId === sessionId
        ? { ...session, title: normalized, updatedAt: new Date().toISOString() }
        : session,
    ),
    storage,
  );
  return found;
}

export async function deleteSavedSession(
  sessionId: string,
  storage: Storage = localStorage,
): Promise<boolean> {
  if (isTauriStorage()) return invoke<boolean>("delete_completed_session", { sessionId });
  const sessions = readBrowserSessions(storage);
  const remaining = sessions.filter((session) => session.sessionId !== sessionId);
  writeBrowserSessions(remaining, storage);
  return remaining.length !== sessions.length;
}

export async function deleteAllSavedSessions(storage: Storage = localStorage): Promise<number> {
  if (isTauriStorage()) return invoke<number>("delete_all_sessions");
  const count = readBrowserSessions(storage).length;
  writeBrowserSessions([], storage);
  return count;
}

export async function getStorageStatistics(
  storage: Storage = localStorage,
): Promise<StorageStatistics> {
  if (isTauriStorage()) return invoke<StorageStatistics>("get_storage_statistics");
  const sessions = readBrowserSessions(storage);
  return {
    storageMode: "browser-development",
    totalRecordings: sessions.length,
    totalNotes: sessions.filter((session) => session.notes !== null).length,
    databaseSizeBytes: new Blob([storage.getItem(BROWSER_STORAGE_KEY) ?? ""]).size,
    integrity: "not_applicable",
  };
}

function parseLegacySessions(raw: string): SessionInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Legacy session data is invalid JSON. It was preserved for recovery.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Legacy session data has an invalid shape. It was preserved for recovery.");
  }
  const unique = new Map<string, SessionInput>();
  for (const value of parsed) {
    const normalized = normalizeLegacySession(value);
    if (!normalized) {
      throw new Error("A legacy session is incomplete. All original data was preserved.");
    }
    if (!unique.has(normalized.sessionId)) unique.set(normalized.sessionId, normalized);
  }
  return [...unique.values()];
}

function normalizeLegacySession(value: unknown): SessionInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const transcript = candidate.transcript as SpeechSessionResult["transcript"] | undefined;
  if (
    typeof candidate.sessionId !== "string" ||
    typeof candidate.createdAt !== "string" ||
    !transcript ||
    transcript.session_id !== candidate.sessionId ||
    !Array.isArray(transcript.segments)
  ) {
    return null;
  }
  const notes = isNotesDocument(candidate.notes) ? candidate.notes : null;
  return {
    sessionId: candidate.sessionId,
    title:
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title
        : (notes?.title ?? "Untitled recording"),
    createdAt: candidate.createdAt,
    durationSeconds: transcript.segments.at(-1)?.end ?? 0,
    transcriptStatus: "completed",
    transcript,
    notes,
  };
}

function readBrowserSessions(storage: Storage): SavedSession[] {
  try {
    const parsed = JSON.parse(storage.getItem(BROWSER_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedSession).slice(0, MAX_BROWSER_SESSIONS);
  } catch {
    return [];
  }
}

function writeBrowserSessions(sessions: SavedSession[], storage: Storage): void {
  storage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_BROWSER_SESSIONS)));
}

function toSavedSession(input: SessionInput): SavedSession {
  return {
    ...input,
    updatedAt: input.createdAt,
    notesStatus: input.notes ? "generated" : "not_generated",
  };
}

function isSavedSession(value: unknown): value is SavedSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedSession>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.durationSeconds === "number" &&
    !!candidate.transcript &&
    Array.isArray(candidate.transcript.segments)
  );
}

function isNotesDocument(value: unknown): value is NotesDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NotesDocument>;
  return (
    typeof candidate.title === "string" &&
    Array.isArray(candidate.keyPoints) &&
    Array.isArray(candidate.actionItems) &&
    Array.isArray(candidate.importantInformation) &&
    Array.isArray(candidate.decisions) &&
    Array.isArray(candidate.additionalContext)
  );
}
