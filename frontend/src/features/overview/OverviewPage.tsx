import { Mic, Play } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import type { PageId } from "../../types/navigation";

interface OverviewPageProps {
  onNavigate: (page: PageId) => void;
}

export function OverviewPage({ onNavigate }: OverviewPageProps) {
  return (
    <div className="mx-auto max-w-360 px-[clamp(24px,4vw,64px)] pt-10 pb-16">
      <header className="mb-8">
        <div>
          <span className="text-xs font-medium text-[#A3A3A3]">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <h1 className="mt-2 text-[clamp(28px,3vw,32px)] leading-tight font-semibold tracking-[-0.03em]">
            {greeting()}.
          </h1>
        </div>
      </header>

      <Card className="relative grid min-h-95 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_4%_0%,rgb(129_140_248/13%),transparent_42%)]" />
        <div className="relative z-10 flex max-w-150 flex-col justify-center p-9 md:p-10">
          <div className="mb-9 flex size-14 items-center justify-center rounded-xl border border-[#59639A] bg-[#303554] text-[#C7D2FE] shadow-[0_8px_24px_rgb(79_70_229/16%)]">
            <Mic size={27} strokeWidth={1.9} />
          </div>
          <span className="text-[11px] font-semibold tracking-[0.15em] text-[#818CF8] uppercase">
            New conversation
          </span>
          <h2 className="mt-3 mb-2 text-[clamp(29px,3vw,34px)] font-medium tracking-[-0.035em] text-[#F5F5F5]">
            Start listening
          </h2>
          <p className="mb-7 max-w-135 text-sm leading-6 text-[#B0B0B0]">
            Record a conversation and let Noto organize the important parts for you.
          </p>
          <Button className="w-fit px-4" onClick={() => onNavigate("recording")}>
            <Play fill="currentColor" size={14} /> Start recording
          </Button>
        </div>
        <div className="relative z-10 m-4 hidden min-h-80 overflow-hidden rounded-xl border border-[#383838] md:block">
          <img
            alt="Atmospheric floral artwork behind textured glass"
            className="h-full w-full object-cover object-center"
            src="/imgs/2.jpg"
          />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(37_37_37/22%),transparent_35%)]" />
        </div>
      </Card>
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
