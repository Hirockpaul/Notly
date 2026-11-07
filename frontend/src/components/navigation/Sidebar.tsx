import { FileText, LayoutDashboard, Settings } from "lucide-react";

import { NotoLogo } from "../icons/NotoLogo";
import type { PageId } from "../../types/navigation";

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "notes", label: "My Notes", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
] satisfies { id: PageId; label: string; icon: typeof LayoutDashboard }[];

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-[#383838] bg-[#222222] px-3 pt-5 pb-4">
      <div className="flex items-center gap-3 px-2.5 pb-8 text-base font-semibold tracking-[-0.02em]">
        <NotoLogo className="shrink-0" size={32} />
        <span>Noto AI</span>
      </div>

      <nav aria-label="Primary navigation" className="flex flex-col gap-1">
        <span className="px-3 pb-2 text-xs font-medium text-[#A3A3A3]">Workspace</span>
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            aria-current={activePage === id ? "page" : undefined}
            className={`relative flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#3B82F6] hover:bg-[#343434] hover:text-[#F5F5F5] ${activePage === id ? "bg-[#343434] text-[#F5F5F5]" : "text-[#B0B0B0]"}`}
            key={id}
            onClick={() => onNavigate(id)}
            type="button"
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {activePage === id ? (
              <span className="absolute left-0 h-4 w-0.5 rounded-full bg-[#3B82F6]" />
            ) : null}
          </button>
        ))}
      </nav>

      <div className="mt-auto grid gap-2 border-t border-[#383838] px-2.5 pt-4 text-xs text-[#A3A3A3]">
        <div className="flex items-center gap-2">
          <span className="size-[7px] rounded-full bg-[#22C55E]" />
          <span>System ready</span>
        </div>
        <span>Version 0.1.0</span>
      </div>
    </aside>
  );
}
