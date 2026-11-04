import { AudioWaveform, CircleDot, FileText, LayoutDashboard, Settings } from "lucide-react";

import type { PageId } from "../../types/navigation";

interface SidebarProps {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "recording", label: "Recording", icon: AudioWaveform },
  { id: "notes", label: "My Notes", icon: FileText },
  { id: "settings", label: "Settings", icon: Settings },
] satisfies { id: PageId; label: string; icon: typeof LayoutDashboard }[];

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r border-[#1d2029] bg-[#0c0e14] px-4 pt-7 pb-5">
      <div className="flex items-center gap-3 px-2.5 pb-8.5 text-base font-bold tracking-tight">
        <div
          className="flex size-8.5 items-center justify-center rounded-[10px] border border-white/15 bg-gradient-to-br from-indigo-300 to-indigo-500 text-white shadow-[0_7px_18px_rgb(86_97_220/22%)]"
          aria-hidden="true"
        >
          <AudioWaveform size={19} strokeWidth={2.4} />
        </div>
        <span>Noto AI</span>
      </div>

      <nav aria-label="Primary navigation" className="flex flex-col gap-1">
        <span className="px-3 pb-2 text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
          Workspace
        </span>
        {navigation.map(({ id, label, icon: Icon }) => (
          <button
            aria-current={activePage === id ? "page" : undefined}
            className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:translate-x-px hover:bg-white/4 hover:text-[#f4f5f7] ${activePage === id ? "bg-indigo-400/10 text-indigo-200 hover:bg-indigo-400/15" : "text-[#9298a7]"}`}
            key={id}
            onClick={() => onNavigate(id)}
            type="button"
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {id === "recording" ? <CircleDot className="ml-auto text-[#686f80]" size={10} /> : null}
          </button>
        ))}
      </nav>

      <div className="mt-auto grid gap-2 border-t border-[#1d2029] px-2.5 pt-4.5 text-[11px] text-[#686f80]">
        <div className="flex items-center gap-2">
          <span className="size-[7px] rounded-full bg-green-400 shadow-[0_0_0_4px_rgb(74_222_128/9%)]" />
          <span>System ready</span>
        </div>
        <span>Version 0.1.0</span>
      </div>
    </aside>
  );
}
