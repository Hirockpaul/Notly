import { useEffect, useState } from "react";

import { NotesPage } from "./features/notes/NotesPage";
import { OverviewPage } from "./features/overview/OverviewPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { RecordingPage } from "./features/transcription/RecordingPage";
import { AppShell } from "./layouts/AppShell";
import {
  getBackendStatus,
  requiresDesktopBackend,
  restartBackend,
} from "./services/backend-lifecycle";
import type { BackendStatus } from "./services/backend-lifecycle";
import { initializeSessionStorage } from "./services/session-storage";
import type { PageId } from "./types/navigation";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("overview");
  const [storageState, setStorageState] = useState<"loading" | "ready" | "error">("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const desktopBackendRequired = requiresDesktopBackend();
  const [backend, setBackend] = useState<BackendStatus>(
    desktopBackendRequired
      ? { phase: "starting", message: null }
      : { phase: "ready", message: null },
  );

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

  useEffect(() => {
    if (!desktopBackendRequired) return;
    let active = true;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const check = async () => {
      try {
        const status = await getBackendStatus();
        if (!active) return;
        setBackend(status);
        timer = globalThis.setTimeout(() => void check(), status.phase === "ready" ? 2000 : 500);
      } catch {
        if (!active) return;
        setBackend({ phase: "failed", message: "Could not read the local backend status." });
        timer = globalThis.setTimeout(() => void check(), 2000);
      }
    };
    void check();
    return () => {
      active = false;
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [desktopBackendRequired]);

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

  if (backend.phase !== "ready") {
    const failed = backend.phase === "failed" || backend.phase === "stopped";
    return (
      <main className="grid min-h-screen place-items-center bg-[#1F1F1F] p-8 text-center text-[#F5F5F5]">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold">
            {failed ? "Local backend needs attention" : "Starting local backend..."}
          </h1>
          <p className="mt-3 text-xs leading-6 text-[#A3A3A3]">
            {backend.message ?? "Noto is securely starting its local transcription service."}
          </p>
          {failed ? (
            <button
              className="mt-5 rounded-md bg-[#F5F5F5] px-4 py-2 text-xs font-medium text-[#1F1F1F]"
              onClick={() => {
                setBackend({ phase: "starting", message: null });
                void restartBackend().catch((error: unknown) =>
                  setBackend({
                    phase: "failed",
                    message: error instanceof Error ? error.message : String(error),
                  }),
                );
              }}
              type="button"
            >
              Restart backend
            </button>
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
