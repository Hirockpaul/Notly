import { Clock3, FileText, Pencil, Search, Trash2 } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useState } from "react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import {
  deleteSavedSession,
  listSavedSessions,
  updateSessionTitle,
} from "../../services/session-storage";
import type { SavedSession } from "../../services/session-storage";
import { NotesPanel } from "./NotesPanel";

export function NotesPage() {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [activeView, setActiveView] = useState<"transcript" | "notes">("transcript");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const deferredQuery = useDeferredValue(query);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await listSavedSessions();
      setSessions(loaded);
      setSelectedId((current) =>
        loaded.some((session) => session.sessionId === current)
          ? current
          : (loaded[0]?.sessionId ?? ""),
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Saved recordings could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listSavedSessions()
      .then((loaded) => {
        if (!active) return;
        setSessions(loaded);
        setSelectedId(loaded[0]?.sessionId ?? "");
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Saved recordings could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredSessions = sessions.filter((session) =>
    `${session.title} ${session.notes?.summary ?? ""} ${session.transcript.segments.map((segment) => segment.text).join(" ")}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  const selectedSession = sessions.find((session) => session.sessionId === selectedId) ?? null;

  const renameSelected = async () => {
    if (!selectedSession) return;
    const title = window.prompt("Recording title", selectedSession.title);
    if (title === null || title.trim() === selectedSession.title) return;
    try {
      await updateSessionTitle(selectedSession.sessionId, title);
      await refresh();
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : "The recording could not be renamed.",
      );
    }
  };

  const deleteSelected = async () => {
    if (!selectedSession) return;
    if (!window.confirm(`Permanently delete “${selectedSession.title}” and its notes?`)) return;
    try {
      await deleteSavedSession(selectedSession.sessionId);
      await refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "The recording could not be deleted.",
      );
    }
  };

  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-7 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[#737373]">Device-local library</span>
          <h1 className="mt-2 text-[clamp(28px,3vw,32px)] leading-tight font-semibold tracking-[-0.03em]">
            My Notes
          </h1>
          <p className="mt-2.5 text-sm text-[#A3A3A3]">
            Completed transcripts and generated notes stored on this device.
          </p>
        </div>
        <span className="rounded-full border border-[#383838] bg-[#303030] px-3 py-2 text-[11px] text-[#A3A3A3]">
          {sessions.length} recordings
        </span>
      </header>

      {error ? (
        <p className="mb-4 rounded-lg bg-[#EF4444]/10 p-3 text-xs text-[#EF4444]" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <Card className="grid min-h-80 place-items-center p-8 text-xs text-[#737373]">
          Loading local recordings...
        </Card>
      ) : sessions.length === 0 ? (
        <Card className="grid min-h-80 place-items-center p-8 text-center">
          <div>
            <FileText className="mx-auto text-[#737373]" size={28} />
            <h2 className="mt-4 text-sm font-semibold">No completed recordings yet</h2>
            <p className="mt-2 text-xs text-[#737373]">
              Completed recordings will be saved in the active local storage mode.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(280px,.8fr)_minmax(0,1.4fr)] gap-4">
          <Card className="p-4">
            <label className="flex items-center gap-2 rounded-[10px] border border-[#383838] bg-[#343434] px-3 text-[#737373] focus-within:border-[#3B82F6]">
              <Search aria-hidden="true" size={17} />
              <span className="sr-only">Search saved recordings</span>
              <input
                className="min-w-0 flex-1 border-0 bg-transparent py-3 text-[#F5F5F5] outline-none placeholder:text-[#737373]"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search transcripts and notes..."
                type="search"
                value={query}
              />
            </label>
            <div className="mt-3 grid gap-1" aria-label="Saved recordings">
              {filteredSessions.map((session) => (
                <button
                  aria-pressed={selectedSession?.sessionId === session.sessionId}
                  className={`cursor-pointer rounded-[10px] border p-3.5 text-left transition ${selectedSession?.sessionId === session.sessionId ? "border-[#3B82F6] bg-[#343434]" : "border-transparent hover:bg-[#303030]"}`}
                  key={session.sessionId}
                  onClick={() => setSelectedId(session.sessionId)}
                  type="button"
                >
                  <strong className="block text-xs">{session.title}</strong>
                  <span className="mt-1 block text-[10px] text-[#737373]">
                    {new Date(session.createdAt).toLocaleString()} ·{" "}
                    {session.notes ? "Notes ready" : "Transcript only"}
                  </span>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-[#A3A3A3]">
                    {session.notes?.summary ??
                      session.transcript.segments[0]?.text ??
                      "No meaningful speech."}
                  </p>
                  <span className="mt-3 flex items-center gap-1 text-[10px] text-[#737373]">
                    <Clock3 size={12} /> {formatDuration(session.durationSeconds)}
                  </span>
                </button>
              ))}
              {filteredSessions.length === 0 ? (
                <p className="py-10 text-center text-xs text-[#737373]">
                  No recordings match “{query}”.
                </p>
              ) : null}
            </div>
          </Card>

          <Card className="p-7" variant="elevated">
            <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[#383838] pb-4">
              <div>
                <h2 className="text-base font-semibold">{selectedSession?.title}</h2>
                <p className="mt-1 text-[10px] text-[#737373]">
                  {selectedSession ? new Date(selectedSession.createdAt).toLocaleString() : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void renameSelected()} size="small" variant="secondary">
                  <Pencil size={13} /> Rename
                </Button>
                <Button onClick={() => void deleteSelected()} size="small" variant="danger">
                  <Trash2 size={13} /> Delete
                </Button>
              </div>
            </header>
            <div className="mb-5 flex gap-2" aria-label="Saved recording view">
              <Button
                onClick={() => setActiveView("transcript")}
                size="small"
                variant={activeView === "transcript" ? "primary" : "secondary"}
              >
                Transcript
              </Button>
              <Button
                disabled={!selectedSession?.notes}
                onClick={() => setActiveView("notes")}
                size="small"
                variant={activeView === "notes" ? "primary" : "secondary"}
              >
                AI Notes
              </Button>
            </div>
            {activeView === "notes" && selectedSession?.notes ? (
              <NotesPanel
                canGenerate={false}
                delivery={{
                  title: selectedSession.title,
                  createdAt: selectedSession.createdAt,
                  durationSeconds: selectedSession.durationSeconds,
                }}
                error={null}
                notes={selectedSession.notes}
                onGenerate={() => undefined}
                status="generated"
              />
            ) : (
              <div className="grid gap-3">
                {selectedSession?.transcript.segments.map((segment) => (
                  <p className="text-xs leading-6 text-[#A3A3A3]" key={segment.utterance_id}>
                    <span className="mr-2 text-[#F5F5F5]">{formatDuration(segment.start)}</span>
                    {segment.text}
                  </p>
                ))}
                {selectedSession?.transcript.segments.length === 0 ? (
                  <p className="py-8 text-center text-xs text-[#737373]">
                    No speech was saved for this recording.
                  </p>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
