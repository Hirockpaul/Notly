import { useEffect, useState } from "react";

import { NotesPage } from "./features/notes/NotesPage";
import { OverviewPage } from "./features/overview/OverviewPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { RecordingPage } from "./features/transcription/RecordingPage";
import { AppShell } from "./layouts/AppShell";
import { initializeSessionStorage } from "./services/session-storage";
import type { PageId } from "./types/navigation";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [storageState, setStorageState] = useState<"loading" | "ready" | "error">("loading");
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void initializeSessionStorage()
      .then(() => {
        if (active) setStorageState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStorageError(
          error instanceof Error ? error.message : "Local storage initialization failed.",
        );
        setStorageState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  if (storageState !== "ready") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#1F1F1F] p-8 text-center text-[#F5F5F5]">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold">
            {storageState === "loading"
              ? "Opening local storage..."
              : "Local storage needs attention"}
          </h1>
          <p className="mt-3 text-xs leading-6 text-[#A3A3A3]">
            {storageError ?? "Initializing the local Noto database and checking legacy sessions."}
          </p>
          {storageState === "error" ? (
            <p className="mt-3 text-[10px] text-[#737373]">
              No database or legacy browser data was deleted. Restart after resolving the storage
              issue.
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <AppShell activePage={activePage} onNavigate={setActivePage}>
      {activePage === "overview" ? <OverviewPage onNavigate={setActivePage} /> : null}
      {activePage === "recording" ? <RecordingPage /> : null}
      {activePage === "notes" ? <NotesPage /> : null}
      {activePage === "settings" ? <SettingsPage /> : null}
    </AppShell>
  );
}
