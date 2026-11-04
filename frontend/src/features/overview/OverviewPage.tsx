import { ArrowRight, Clock3, FileText, Mic2, MoreHorizontal, Play, Sparkles } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { notes } from "../../lib/mock-data";
import type { PageId } from "../../types/navigation";

interface OverviewPageProps {
  onNavigate: (page: PageId) => void;
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
            Wednesday, November 4
          </span>
          <h1 className="mt-2 text-[clamp(29px,3vw,38px)] leading-[1.1] font-semibold tracking-[-0.045em]">
            Good afternoon.
          </h1>
          <p className="mt-2.5 text-sm text-[#9298a7]">
            Capture the conversation. Keep what matters.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[#252936] bg-white/3 px-3 py-2 text-[11px] text-[#9298a7]">
          <span className="size-[7px] rounded-full bg-green-400 shadow-[0_0_0_4px_rgb(74_222_128/9%)]" />{" "}
          Ready to listen
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1.7fr)_repeat(2,minmax(150px,.65fr))] gap-4">
        <Card className="relative row-span-2 min-h-82.5 overflow-hidden p-9 after:pointer-events-none after:absolute after:inset-0 after:bg-gradient-to-r after:from-indigo-400/8 after:to-transparent">
          <div className="pointer-events-none absolute -top-37.5 -left-25 h-90 w-125 bg-[radial-gradient(circle,rgb(99_102_241/25%)_0,transparent_66%)]" />
          <div className="relative z-10 max-w-100">
            <div className="mb-8.5 flex size-13 items-center justify-center rounded-[14px] border border-indigo-400/20 bg-indigo-400/10 text-indigo-300">
              <Mic2 size={27} />
            </div>
            <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
              New conversation
            </span>
            <h2 className="my-2 text-[clamp(25px,3vw,34px)] tracking-[-0.04em]">Start listening</h2>
            <p className="mb-6 max-w-90 text-[13px] leading-7 text-[#9298a7]">
              Record a conversation and let Noto organize the important parts for you.
            </p>
            <Button onClick={() => onNavigate("recording")}>
              <Play fill="currentColor" size={15} /> Start recording
            </Button>
          </div>
          <div
            className="absolute right-8 bottom-7 flex h-18 -rotate-8 items-center gap-1 opacity-25"
            aria-hidden="true"
          >
            {[18, 30, 46, 25, 60, 38, 70, 42, 56, 32, 48, 24, 34].map((height, index) => (
              <span className="w-[3px] rounded bg-indigo-400" key={index} style={{ height }} />
            ))}
          </div>
        </Card>

        <Card className="min-h-39 p-5">
          <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-indigo-400/10 text-indigo-300">
            <FileText size={19} />
          </div>
          <span className="mt-4 block text-[11px] text-[#9298a7]">Total notes</span>
          <strong className="mt-1 block text-2xl font-semibold tracking-[-0.04em]">28</strong>
          <small className="text-[10px] text-[#686f80]">4 added this week</small>
        </Card>

        <Card className="min-h-39 p-5">
          <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-cyan-300/10 text-cyan-300">
            <Clock3 size={19} />
          </div>
          <span className="mt-4 block text-[11px] text-[#9298a7]">Recent sessions</span>
          <strong className="mt-1 block text-2xl font-semibold tracking-[-0.04em]">06</strong>
          <small className="text-[10px] text-[#686f80]">2h 14m captured</small>
        </Card>

        <Card className="col-span-2 p-6">
          <SectionHeader
            action={
              <Button onClick={() => onNavigate("notes")} size="small" variant="ghost">
                View all <ArrowRight size={14} />
              </Button>
            }
            description="Your latest captured conversations"
            title="Recent notes"
          />
          <div className="mt-4.5 grid">
            {notes.slice(0, 3).map((note) => (
              <button
                className="group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-[#1d2029] bg-transparent px-0.5 py-4 text-left first:border-t-0"
                key={note.id}
                onClick={() => onNavigate("notes")}
                type="button"
              >
                <div className="flex size-9 items-center justify-center rounded-[9px] bg-white/4 text-[#9298a7] transition group-hover:bg-indigo-400/15 group-hover:text-indigo-200">
                  <FileText size={17} />
                </div>
                <div className="min-w-0">
                  <strong className="block truncate text-xs">{note.title}</strong>
                  <span className="mt-1 block truncate text-[10px] text-[#686f80]">
                    {note.preview}
                  </span>
                </div>
                <div className="grid justify-items-end gap-1 text-[10px] text-[#9298a7]">
                  <span>{note.date}</span>
                  <small className="text-[#686f80]">{note.duration}</small>
                </div>
                <MoreHorizontal aria-hidden="true" className="text-[#686f80]" size={18} />
              </button>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col justify-between p-6" variant="elevated">
          <div className="flex items-center justify-between">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-purple-400/10 text-purple-300">
              <Sparkles size={19} />
            </div>
            <span className="rounded-full border border-purple-400/15 bg-purple-400/10 px-2 py-1 text-[9px] text-purple-200">
              Quick access
            </span>
          </div>
          <div>
            <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
              Last recording
            </span>
            <h3 className="mt-2 text-sm">Product strategy sync</h3>
            <p className="mt-1 text-[10px] text-[#686f80]">Today · 38 minutes · 3 speakers</p>
          </div>
          <Button onClick={() => onNavigate("notes")} variant="secondary">
            Open note <ArrowRight size={15} />
          </Button>
        </Card>
      </div>
    </div>
  );
}
