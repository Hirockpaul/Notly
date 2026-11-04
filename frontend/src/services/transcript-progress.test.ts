import { describe, expect, it } from "vitest";

import { getProgressStatus, normalizeTranscriptSegments } from "./transcript-progress";

describe("transcript progress", () => {
  it("deduplicates reconnect snapshots and orders them by timestamp", () => {
    const segments = normalizeTranscriptSegments([
      { utterance_id: "second", speaker: "You", text: "Second", start: 2, end: 3 },
      { utterance_id: "first", speaker: "You", text: "Old", start: 0, end: 1 },
      { utterance_id: "first", speaker: "You", text: "First", start: 0, end: 1 },
    ]);

    expect(segments.map(({ utterance_id, text }) => ({ utterance_id, text }))).toEqual([
      { utterance_id: "first", text: "First" },
      { utterance_id: "second", text: "Second" },
    ]);
  });

  it("reports detecting separately from pending transcription", () => {
    const base = {
      errors: [],
      sessionId: "session",
      status: "recording" as const,
      transcript: { session_id: "session", segments: [] },
    };
    expect(getProgressStatus({ ...base, pendingUtterances: 0 })).toBe("detecting");
    expect(getProgressStatus({ ...base, pendingUtterances: 2 })).toBe("transcribing");
  });
});
