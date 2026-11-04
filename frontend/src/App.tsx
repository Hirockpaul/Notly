import { useState } from "react";

import { NotesPage } from "./features/notes/NotesPage";
import { OverviewPage } from "./features/overview/OverviewPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { RecordingPage } from "./features/transcription/RecordingPage";
import { AppShell } from "./layouts/AppShell";
import type { PageId } from "./types/navigation";

export function App() {
  const [activePage, setActivePage] = useState<PageId>("overview");

  return (
    <AppShell activePage={activePage} onNavigate={setActivePage}>
      {activePage === "overview" ? <OverviewPage onNavigate={setActivePage} /> : null}
      {activePage === "recording" ? <RecordingPage /> : null}
      {activePage === "notes" ? <NotesPage /> : null}
      {activePage === "settings" ? <SettingsPage /> : null}
    </AppShell>
  );
}
