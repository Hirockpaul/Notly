import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import type { ReactNode } from "react";

import { NotoLogo } from "../icons/NotoLogo";

const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function TitleBar() {
  if (!isDesktop) return null;

  const appWindow = getCurrentWindow();

  return (
    <header
      className="relative flex h-9 shrink-0 select-none items-center border-b border-[#383838] bg-[#202020]"
      data-tauri-drag-region
      onDoubleClick={() => void appWindow.toggleMaximize()}
    >
      <div className="pointer-events-none flex items-center gap-2 px-3" data-tauri-drag-region>
        <NotoLogo size={18} />
      </div>
      <span
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-medium text-[#F5F5F5]"
        data-tauri-drag-region
      >
        Noto AI
      </span>
      <div className="ml-auto flex h-full" onDoubleClick={(event) => event.stopPropagation()}>
        <WindowControl label="Minimize" onClick={() => void appWindow.minimize()}>
          <Minus size={14} strokeWidth={1.7} />
        </WindowControl>
        <WindowControl label="Maximize or restore" onClick={() => void appWindow.toggleMaximize()}>
          <Square size={11} strokeWidth={1.6} />
        </WindowControl>
        <WindowControl danger label="Close" onClick={() => void appWindow.close()}>
          <X size={14} strokeWidth={1.7} />
        </WindowControl>
      </div>
    </header>
  );
}

function WindowControl({
  children,
  danger = false,
  label,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`grid h-full w-11 place-items-center text-[#A3A3A3] transition-colors duration-150 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#3B82F6] ${danger ? "hover:bg-[#C42B1C] hover:text-white" : "hover:bg-[#343434] hover:text-[#F5F5F5]"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
