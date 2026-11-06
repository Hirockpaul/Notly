import { Mic2, Play } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import type { PageId } from "../../types/navigation";

interface OverviewPageProps {
  onNavigate: (page: PageId) => void;
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <span className="text-xs font-medium text-[#737373]">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <h1 className="mt-2 text-[clamp(28px,3vw,32px)] leading-tight font-semibold tracking-[-0.03em]">
            Good afternoon.
          </h1>
          <p className="mt-2.5 text-sm text-[#A3A3A3]">
            Capture the conversation. Keep what matters.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[#383838] bg-[#292929] px-3 py-2 text-xs text-[#A3A3A3]">
          <span className="size-[7px] rounded-full bg-[#22C55E]" /> Ready to listen
        </div>
      </header>

      <div>
        <Card className="relative min-h-80 overflow-hidden border-[#30364D] bg-[#151722] p-9 shadow-[inset_0_1px_0_rgb(255_255_255/5%),0_18px_50px_rgb(0_0_0/25%)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_4%_0%,rgb(91_99_211/25%),transparent_43%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_15%,rgb(255_255_255/3%)_34%,transparent_53%)]" />

          <div className="relative z-10 max-w-110">
            <div className="mb-9 flex size-13 items-center justify-center rounded-[14px] border border-[#5963A7]/65 bg-[linear-gradient(145deg,#353B72_0%,#232847_100%)] text-[#ACB5FF] shadow-[inset_0_1px_0_rgb(255_255_255/20%),0_12px_28px_rgb(31_38_96/35%)]">
              <Mic2 size={27} />
            </div>
            <span className="text-[11px] font-semibold tracking-[0.15em] text-[#747B91] uppercase">
              New conversation
            </span>
            <h2 className="mt-3 mb-2 text-[clamp(28px,3vw,34px)] font-medium tracking-[-0.035em] text-[#F2F3F8]">
              Start listening
            </h2>
            <p className="mb-7 max-w-100 text-sm leading-7 text-[#979CAD]">
              Record a conversation and let Noto organize the important parts for you.
            </p>
            <Button
              variant="accent"
              className="min-h-9 rounded-[5px] px-4 font-normal"
              onClick={() => onNavigate("recording")}
            >
              <Play fill="currentColor" size={15} /> Start recording
            </Button>
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-8 bottom-9 flex h-20 items-center gap-1 opacity-75"
          >
            {[22, 38, 56, 34, 68, 45, 61, 42, 55, 29].map((height, index) => (
              <span
                key={`${height}-${index}`}
                className="w-[3px] rounded-full bg-[linear-gradient(180deg,#6975C5_0%,#354079_100%)] shadow-[0_0_9px_rgb(105_117_197/25%)]"
                style={{ height }}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
