import { afterEach, describe, expect, it, vi } from "vitest";

import type { NotesDocument, SpeechSessionResult } from "./audio-backend-client";
import {
  LEGACY_STORAGE_KEY,
  deleteAllSavedSessions,
  deleteSavedSession,
  getStorageStatistics,
  initializeSessionStorage,
  listSavedSessions,
  saveCompletedSession,
  saveGeneratedNotes,
  updateSessionTitle,
} from "./session-storage";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const result: SpeechSessionResult = {
  sessionId: "session",
  status: "completed",
  errors: [],
  transcript: {
    session_id: "session",
    segments: [{ utterance_id: "one", speaker: "You", text: "Grounded text", start: 0, end: 1 }],
  },
};

const notes: NotesDocument = {
  title: "Grounded notes",
  summary: "Grounded text",
  keyPoints: [],
  actionItems: [],
  importantInformation: [],
  decisions: [],
  additionalContext: [],
};

afterEach(() => {
  invokeMock.mockReset();
  vi.unstubAllGlobals();
});

describe("browser development storage", () => {
  it("saves, renames, lists, adds notes, deletes, and reports statistics", async () => {
    const storage = new MemoryStorage();
    await saveCompletedSession(result, storage);
    await saveGeneratedNotes("session", notes, storage);
    await updateSessionTitle("session", "Renamed", storage);

    expect(await listSavedSessions(storage)).toEqual([
      expect.objectContaining({ sessionId: "session", title: "Renamed", notes }),
    ]);
    expect(await getStorageStatistics(storage)).toMatchObject({
      storageMode: "browser-development",
      totalRecordings: 1,
      totalNotes: 1,
    });
    expect(await deleteSavedSession("session", storage)).toBe(true);
    expect(await deleteAllSavedSessions(storage)).toBe(0);
  });

  it("ignores malformed development fallback data", async () => {
    const storage = new MemoryStorage();
    storage.setItem("noto.browser-development-sessions.v2", "not-json");
    expect(await listSavedSessions(storage)).toEqual([]);
  });

  it("copies valid legacy data for browser development without deleting the original", async () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify([
      {
        sessionId: "legacy",
        createdAt: "2026-11-05T10:00:00Z",
        transcript: {
          session_id: "legacy",
          segments: [{ utterance_id: "one", speaker: "You", text: "Legacy", start: 0, end: 1 }],
        },
        notes: null,
      },
    ]);
    storage.setItem(LEGACY_STORAGE_KEY, raw);

    await initializeSessionStorage(storage);

    expect((await listSavedSessions(storage))[0].sessionId).toBe("legacy");
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
  });
});

describe("legacy SQLite migration", () => {
  function enableTauri() {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  }

  function legacyRecord(sessionId = "session") {
    return {
      sessionId,
      createdAt: "2026-11-05T10:00:00Z",
      transcript: {
        session_id: sessionId,
        segments: [{ utterance_id: "one", speaker: "You", text: "Legacy", start: 0, end: 1 }],
      },
      notes,
    };
  }

  it("imports, verifies, and only then removes valid legacy data", async () => {
    enableTauri();
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([legacyRecord()]));
    invokeMock
      .mockResolvedValueOnce({ imported: 1, skippedExisting: 0, migrationRecorded: true })
      .mockResolvedValueOnce(true);

    await initializeSessionStorage(storage);

    expect(invokeMock.mock.calls[0][0]).toBe("migrate_legacy_sessions");
    const migrationArguments = invokeMock.mock.calls[0][1] as { sessions: unknown[] };
    expect(migrationArguments.sessions).toHaveLength(1);
    expect(invokeMock.mock.calls[1]).toEqual(["confirm_legacy_migration", { expectedRecords: 1 }]);
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("deduplicates legacy IDs before import", async () => {
    enableTauri();
    const storage = new MemoryStorage();
    storage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify([legacyRecord("same"), legacyRecord("same")]),
    );
    invokeMock
      .mockResolvedValueOnce({ imported: 1, skippedExisting: 0, migrationRecorded: true })
      .mockResolvedValueOnce(true);

    await initializeSessionStorage(storage);

    const migrationArguments = invokeMock.mock.calls[0][1] as { sessions: unknown[] };
    expect(migrationArguments.sessions).toHaveLength(1);
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["partial record", JSON.stringify([{ sessionId: "partial" }])],
  ])("preserves %s without invoking SQLite", async (_label, raw) => {
    enableTauri();
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEY, raw);

    await expect(initializeSessionStorage(storage)).rejects.toThrow(/preserved/);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
  });

  it("preserves legacy data when import or verification is interrupted", async () => {
    enableTauri();
    const storage = new MemoryStorage();
    const raw = JSON.stringify([legacyRecord()]);
    storage.setItem(LEGACY_STORAGE_KEY, raw);
    invokeMock.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(initializeSessionStorage(storage)).rejects.toThrow("database unavailable");
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
  });

  it("accepts existing SQLite records without overwriting them", async () => {
    enableTauri();
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify([legacyRecord()]));
    invokeMock
      .mockResolvedValueOnce({ imported: 0, skippedExisting: 1, migrationRecorded: true })
      .mockResolvedValueOnce(true);

    await initializeSessionStorage(storage);

    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});
