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
    <div className="grid min-h-screen min-w-180 grid-cols-[230px_minmax(0,1fr)] bg-[#090b10] font-sans text-[#f4f5f7] antialiased">
      <Sidebar activePage={activePage} onNavigate={onNavigate} />
      <main className="min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}
