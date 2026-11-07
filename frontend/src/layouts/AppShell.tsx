import type { ReactNode } from "react";

import { Sidebar } from "../components/navigation/Sidebar";
import { TitleBar } from "../components/window/TitleBar";
import type { PageId } from "../types/navigation";

interface AppShellProps {
  activePage: PageId;
  children: ReactNode;
  onNavigate: (page: PageId) => void;
}

export function AppShell({ activePage, children, onNavigate }: AppShellProps) {
  return (
    <div className="flex h-screen min-w-180 flex-col overflow-hidden bg-[#171717] font-sans text-[#F5F5F5] antialiased">
      <TitleBar />
      <div className="grid min-h-0 flex-1 grid-cols-[224px_minmax(0,1fr)]">
        <Sidebar activePage={activePage} onNavigate={onNavigate} />
        <main className="min-w-0 overflow-y-auto overscroll-contain">{children}</main>
      </div>
    </div>
  );
}
