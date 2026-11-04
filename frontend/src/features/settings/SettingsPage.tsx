import { Bell, Bot, Check, ChevronDown, Mic2, SlidersHorizontal, Volume2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Toggle } from "../../components/ui/Toggle";

interface SettingRowProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-5 border-t border-[#252936] py-4 first:border-t-0">
      <div>
        <strong className="text-xs">{title}</strong>
        <p className="mt-1 text-[10px] text-[#686f80]">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const [noiseReduction, setNoiseReduction] = useState(true);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [discordConnected, setDiscordConnected] = useState(false);

  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-7 flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold tracking-[0.12em] text-[#686f80] uppercase">
            Preferences
          </span>
          <h1 className="mt-2 text-[clamp(29px,3vw,38px)] leading-tight font-semibold tracking-[-0.045em]">
            Settings
          </h1>
          <p className="mt-2.5 text-sm text-[#9298a7]">
            Configure how Noto listens, processes, and delivers your notes.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-[#252936] bg-white/3 px-3 py-2 text-[11px] text-[#9298a7]">
          <Check size={13} /> Saved locally
        </span>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-indigo-400/10 text-indigo-300">
              <Mic2 size={19} />
            </div>
            <div>
              <h2 className="text-sm">Microphone</h2>
              <p className="mt-1 text-[10px] text-[#686f80]">
                Choose the audio input used for conversations.
              </p>
            </div>
          </div>
          <SettingRow description="System default input device" title="Input source">
            <button
              className="flex items-center gap-2 rounded-lg border border-[#252936] bg-[#0d0f14] px-3 py-2 text-[11px] text-[#9298a7]"
              type="button"
            >
              Built-in Microphone <ChevronDown size={14} />
            </button>
          </SettingRow>
          <SettingRow description="Preview of your current input level" title="Input level">
            <div className="flex h-8 items-center gap-1" aria-label="Input level placeholder">
              {[30, 55, 74, 48, 66, 38, 58, 44].map((height, index) => (
                <span
                  className="w-1 rounded bg-indigo-400"
                  key={index}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </SettingRow>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-cyan-300/10 text-cyan-300">
              <SlidersHorizontal size={19} />
            </div>
            <div>
              <h2 className="text-sm">Audio processing</h2>
              <p className="mt-1 text-[10px] text-[#686f80]">
                Visual preferences for future audio processing.
              </p>
            </div>
          </div>
          <SettingRow
            description="Reduce steady background sound during capture"
            title="Noise reduction"
          >
            <Toggle
              checked={noiseReduction}
              label="Toggle noise reduction"
              onChange={setNoiseReduction}
            />
          </SettingRow>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-purple-400/10 text-purple-300">
              <Bot size={19} />
            </div>
            <div>
              <h2 className="text-sm">Discord delivery</h2>
              <p className="mt-1 text-[10px] text-[#686f80]">
                Send completed notes to a private Discord channel.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-[#252936] bg-[#0d0f14] p-3.5">
            <div
              className="grid size-9 place-items-center rounded-lg bg-indigo-400/10 font-bold text-indigo-300"
              aria-hidden="true"
            >
              #
            </div>
            <div>
              <strong className="text-xs">
                {discordConnected ? "Discord connected" : "Discord webhook"}
              </strong>
              <p className="mt-1 text-[10px] text-[#686f80]">
                {discordConnected ? "Ready for future note delivery" : "No webhook configured"}
              </p>
            </div>
            <Button
              onClick={() => setDiscordConnected((connected) => !connected)}
              size="small"
              variant={discordConnected ? "ghost" : "secondary"}
            >
              {discordConnected ? "Disconnect" : "Configure"}
            </Button>
          </div>
          <p className="mt-3 text-[10px] leading-5 text-[#686f80]">
            Webhook values will be stored outside the frontend when this integration is implemented.
          </p>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-amber-300/10 text-amber-300">
              <Volume2 size={19} />
            </div>
            <div>
              <h2 className="text-sm">Application</h2>
              <p className="mt-1 text-[10px] text-[#686f80]">Control Noto's desktop behavior.</p>
            </div>
          </div>
          <SettingRow description="Open Noto when your computer starts" title="Launch at startup">
            <Toggle
              checked={launchAtStartup}
              label="Toggle launch at startup"
              onChange={setLaunchAtStartup}
            />
          </SettingRow>
          <SettingRow
            description="Show a notification when a note is ready"
            title="Note notifications"
          >
            <Toggle
              checked={notifications}
              label="Toggle note notifications"
              onChange={setNotifications}
            />
          </SettingRow>
        </Card>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[10px] text-[#686f80]">
        <Bell size={14} /> These controls are UI previews and do not change system settings yet.
      </div>
    </div>
  );
}
