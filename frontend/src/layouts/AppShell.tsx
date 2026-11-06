import type { ReactNode } from "react";

import { Sidebar } from "../components/navigation/Sidebar";
import type { PageId } from "../types/navigation";

interface AppShellProps {
  activePage: PageId;
  children: ReactNode;
  onNavigate: (page: PageId) => void;
}

export function AppShell({ activePage, children, onNavigate }: AppShellProps) {
  return (
    <div className="grid min-h-screen min-w-180 grid-cols-[224px_minmax(0,1fr)] bg-[#1F1F1F] font-sans text-[#F5F5F5] antialiased">
      <Sidebar activePage={activePage} onNavigate={onNavigate} />
      <main className="min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}
