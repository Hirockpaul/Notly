import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  Database,
  Download,
  Mic2,
  SlidersHorizontal,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Toggle } from "../../components/ui/Toggle";
import { deleteAllSavedSessions, getStorageStatistics } from "../../services/session-storage";
import type { StorageStatistics } from "../../services/session-storage";
import {
  configureDiscord,
  createBackup,
  disconnectDiscord,
  getDiscordStatus,
  getLastDiscordDelivery,
  restoreBackup,
  selectBackup,
  testDiscord,
} from "../../services/desktop-integrations";
import type { DiscordDeliveryActivity } from "../../services/desktop-integrations";

interface SettingRowProps {
  title: string;
  description: string;
  children: ReactNode;
}

type DiscordUiState =
  "not_configured" | "configured" | "testing" | "connected" | "failed" | "disconnecting";

function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-5 border-t border-[#383838] py-4 first:border-t-0">
      <div>
        <strong className="text-xs">{title}</strong>
        <p className="mt-1 text-[10px] text-[#737373]">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const [noiseReduction, setNoiseReduction] = useState(true);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [discordState, setDiscordState] = useState<DiscordUiState>("not_configured");
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [showDiscordForm, setShowDiscordForm] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState("");
  const [lastDelivery, setLastDelivery] = useState<DiscordDeliveryActivity | null>(() =>
    getLastDiscordDelivery(),
  );
  const [statistics, setStatistics] = useState<StorageStatistics | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshStatistics = useCallback(async () => {
    try {
      setStatistics(await getStorageStatistics());
      setStorageError(null);
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Storage statistics are unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    let active = true;
    void getDiscordStatus()
      .then((configured) => {
        if (active) {
          setDiscordConfigured(configured);
          setDiscordState(configured ? "configured" : "not_configured");
        }
      })
      .catch(() => {
        if (active) setDiscordState("failed");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const update = (event: Event) =>
      setLastDelivery((event as CustomEvent<DiscordDeliveryActivity>).detail);
    window.addEventListener("noto:discord-delivery", update);
    return () => window.removeEventListener("noto:discord-delivery", update);
  }, []);

  const configureWebhook = async () => {
    const value = webhookDraft.trim();
    if (!value) {
      setStorageError("Enter a Discord incoming webhook URL.");
      return;
    }
    setOperation("discord");
    setStorageError(null);
    setNotice(null);
    setDiscordState("testing");
    try {
      await configureDiscord(value);
      setDiscordConfigured(true);
      setDiscordState("connected");
      setWebhookDraft("");
      setShowDiscordForm(false);
      setNotice("Discord webhook verified and stored securely.");
    } catch (error) {
      setDiscordState("failed");
      setStorageError(errorMessage(error, "Discord configuration failed."));
    } finally {
      setOperation(null);
    }
  };

  const removeWebhook = async () => {
    if (!window.confirm("Disconnect Discord and delete the saved webhook credential?")) return;
    setDiscordState("disconnecting");
    setStorageError(null);
    setNotice(null);
    try {
      await disconnectDiscord();
      setDiscordConfigured(false);
      setDiscordState("not_configured");
      setWebhookDraft("");
      setShowDiscordForm(false);
      setNotice("Discord disconnected.");
    } catch (error) {
      setDiscordState("failed");
      setStorageError(errorMessage(error, "Discord disconnect failed."));
    }
  };

  const testWebhook = async () => {
    setDiscordState("testing");
    setStorageError(null);
    setNotice(null);
    try {
      await testDiscord();
      setDiscordState("connected");
      setNotice("Discord connection verified.");
    } catch (error) {
      setDiscordState("failed");
      setStorageError(errorMessage(error, "Discord test failed."));
    }
  };

  const backup = async () => {
    setOperation("backup");
    setStorageError(null);
    try {
      const name = await createBackup();
      if (name)
        setNotice(
          `Backup verified and saved as ${name}. JSON backups are readable and not encrypted.`,
        );
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Backup failed.");
    } finally {
      setOperation(null);
    }
  };

  const restore = async () => {
    setOperation("restore");
    setStorageError(null);
    try {
      const preview = await selectBackup();
      if (!preview) return;
      const choice = window.prompt(
        `Backup ${new Date(preview.createdAt).toLocaleString()} · version ${preview.backupVersion} · ${preview.recordingCount} recordings · ${preview.notesCount} notes.\n\nType MERGE to preserve existing data and skip duplicate IDs. Type REPLACE to permanently delete all current recordings before importing.`,
        "MERGE",
      );
      if (!choice) return;
      const normalized = choice.trim().toUpperCase();
      if (normalized !== "MERGE" && normalized !== "REPLACE") {
        throw new Error("Restore cancelled: enter MERGE or REPLACE exactly.");
      }
      if (
        normalized === "REPLACE" &&
        !window.confirm(
          "Replace all local data? This permanently deletes every current recording and note before the transactional restore.",
        )
      )
        return;
      const result = await restoreBackup(normalized === "REPLACE");
      await refreshStatistics();
      setNotice(
        `Restore complete: ${result.imported} imported, ${result.skippedExisting} duplicates skipped. Integrity: ${result.integrity}.`,
      );
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Restore failed; no partial data was imported.",
      );
    } finally {
      setOperation(null);
    }
  };

  useEffect(() => {
    let active = true;
    void getStorageStatistics()
      .then((value) => {
        if (!active) return;
        setStatistics(value);
        setStorageError(null);
      })
      .catch((error: unknown) => {
        if (active) {
          setStorageError(
            error instanceof Error ? error.message : "Storage statistics are unavailable.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const deleteAllData = async () => {
    if (!window.confirm("Permanently delete every locally saved recording and generated note?")) {
      return;
    }
    if (!window.confirm("This cannot be undone. Delete all local Noto recordings now?")) return;
    try {
      await deleteAllSavedSessions();
      await refreshStatistics();
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Local recordings could not be deleted.",
      );
    }
  };

  return (
    <div className="mx-auto max-w-360 px-[clamp(28px,4vw,64px)] pt-11.5 pb-14">
      <header className="mb-7 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[#737373]">Preferences</span>
          <h1 className="mt-2 text-[clamp(28px,3vw,32px)] leading-tight font-semibold tracking-[-0.03em]">
            Settings
          </h1>
          <p className="mt-2.5 text-sm text-[#A3A3A3]">
            Configure how Noto listens, processes, and delivers your notes.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-[#383838] bg-[#303030] px-3 py-2 text-[11px] text-[#A3A3A3]">
          <Check size={13} /> Saved locally
        </span>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-[#343434] text-[#F5F5F5]">
              <Mic2 size={19} />
            </div>
            <div>
              <h2 className="text-sm">Microphone</h2>
              <p className="mt-1 text-[10px] text-[#737373]">
                Choose the audio input used for conversations.
              </p>
            </div>
          </div>
          <SettingRow description="System default input device" title="Input source">
            <button
              className="flex items-center gap-2 rounded-lg border border-[#383838] bg-[#343434] px-3 py-2 text-[11px] text-[#A3A3A3]"
              type="button"
            >
              Built-in Microphone <ChevronDown size={14} />
            </button>
          </SettingRow>
          <SettingRow description="Preview of your current input level" title="Input level">
            <div className="flex h-8 items-center gap-1" aria-label="Input level placeholder">
              {[30, 55, 74, 48, 66, 38, 58, 44].map((height, index) => (
                <span
                  className="w-1 rounded bg-[#3B82F6]"
                  key={index}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </SettingRow>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-[#343434] text-[#A3A3A3]">
              <SlidersHorizontal size={19} />
            </div>
            <div>
              <h2 className="text-sm">Audio processing</h2>
              <p className="mt-1 text-[10px] text-[#737373]">
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
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-[#343434] text-[#A3A3A3]">
              <Bot size={19} />
            </div>
            <div>
              <h2 className="text-sm">Discord delivery</h2>
              <p className="mt-1 text-[10px] text-[#737373]">
                Send completed notes to a private Discord channel.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[10px] border border-[#383838] bg-[#343434] p-3.5">
            <div
              className="grid size-9 place-items-center rounded-lg bg-[#343434] font-bold text-[#F5F5F5]"
              aria-hidden="true"
            >
              #
            </div>
            <div>
              <strong className="text-xs">
                {discordState === "connected" ? "Discord connected" : "Discord webhook"}
              </strong>
              <p className="mt-1 text-[10px] text-[#737373]">{discordStatusLabel(discordState)}</p>
            </div>
            <Button
              disabled={discordState === "testing" || discordState === "disconnecting"}
              onClick={() => {
                if (!discordConfigured) setShowDiscordForm(true);
                else void removeWebhook();
              }}
              size="small"
              variant={!discordConfigured ? "secondary" : "ghost"}
            >
              {discordState === "disconnecting"
                ? "Disconnecting..."
                : !discordConfigured
                  ? "Configure"
                  : "Disconnect"}
            </Button>
          </div>
          <p className="mt-3 text-[10px] leading-5 text-[#737373]">
            The complete URL is never returned to the UI or written to logs. It is stored in your
            operating system credential vault.
          </p>
          {showDiscordForm ? (
            <div className="mt-3 rounded-[10px] border border-[#383838] bg-[#343434] p-3.5">
              <label className="text-[10px] font-semibold text-[#A3A3A3]" htmlFor="discord-webhook">
                Discord webhook URL
              </label>
              <input
                id="discord-webhook"
                autoComplete="off"
                className="mt-2 w-full rounded-lg border border-[#383838] bg-[#343434] px-3 py-2 text-xs outline-none focus:border-[#3B82F6]"
                onChange={(event) => setWebhookDraft(event.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                type="password"
                value={webhookDraft}
              />
              <div className="mt-3 flex gap-2">
                <Button
                  disabled={operation === "discord" || !webhookDraft.trim()}
                  onClick={() => void configureWebhook()}
                  size="small"
                >
                  {discordState === "testing" ? "Verifying..." : "Save webhook"}
                </Button>
                <Button
                  disabled={operation === "discord"}
                  onClick={() => {
                    setWebhookDraft("");
                    setShowDiscordForm(false);
                    setStorageError(null);
                  }}
                  size="small"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {discordConfigured && !showDiscordForm ? (
            <div className="mt-3 flex gap-2">
              <Button
                className="mt-3"
                disabled={discordState === "testing" || discordState === "disconnecting"}
                onClick={() => void testWebhook()}
                size="small"
                variant="secondary"
              >
                {discordState === "testing" ? "Testing..." : "Test connection"}
              </Button>
              <Button
                disabled={discordState === "testing" || discordState === "disconnecting"}
                onClick={() => {
                  setWebhookDraft("");
                  setShowDiscordForm(true);
                  setStorageError(null);
                  setNotice(null);
                }}
                size="small"
                variant="ghost"
              >
                Change webhook
              </Button>
            </div>
          ) : null}
          {lastDelivery ? (
            <p
              className={`mt-3 text-[10px] ${lastDelivery.kind === "success" ? "text-[#22C55E]" : "text-[#EF4444]"}`}
            >
              Last delivery: {lastDelivery.message} · {new Date(lastDelivery.at).toLocaleString()}
            </p>
          ) : null}
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-[#343434] text-[#A3A3A3]">
              <Volume2 size={19} />
            </div>
            <div>
              <h2 className="text-sm">Application</h2>
              <p className="mt-1 text-[10px] text-[#737373]">Control Noto's desktop behavior.</p>
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

      <Card className="mt-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-8.5 items-center justify-center rounded-[9px] bg-[#343434] text-[#A3A3A3]">
              <Database size={19} />
            </div>
            <div>
              <h2 className="text-sm">Local data and privacy</h2>
              <p className="mt-1 text-[10px] text-[#737373]">
                Packaged desktop recordings use SQLite in Noto's application-data directory.
              </p>
            </div>
          </div>
          <Button
            disabled={!statistics || statistics.totalRecordings === 0}
            onClick={() => void deleteAllData()}
            size="small"
            variant="danger"
          >
            <Trash2 size={13} /> Delete all local recordings
          </Button>
          <div className="flex gap-2">
            <Button
              disabled={operation !== null || !statistics || statistics.totalRecordings === 0}
              onClick={() => void backup()}
              size="small"
              variant="secondary"
            >
              <Download size={13} /> Create backup
            </Button>
            <Button
              disabled={operation !== null}
              onClick={() => void restore()}
              size="small"
              variant="secondary"
            >
              <Upload size={13} /> Restore backup
            </Button>
          </div>
        </div>
        {storageError ? (
          <p className="mt-4 text-xs text-[#EF4444]" role="alert">
            {storageError}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-4 text-xs text-[#22C55E]" role="status">
            {notice}
          </p>
        ) : null}
        <div className="mt-5 grid grid-cols-4 gap-3">
          <StorageMetric label="Storage mode" value={statistics?.storageMode ?? "Loading"} />
          <StorageMetric
            label="Saved recordings"
            value={String(statistics?.totalRecordings ?? 0)}
          />
          <StorageMetric label="Generated notes" value={String(statistics?.totalNotes ?? 0)} />
          <StorageMetric
            label="Approximate size"
            value={formatBytes(statistics?.databaseSizeBytes ?? 0)}
          />
        </div>
        <p className="mt-4 text-[10px] leading-5 text-[#737373]">
          Local transcript and notes content is not encrypted at rest. SQLite storage is local only;
          audio may still be sent to NVIDIA for ASR and transcript text to the configured notes
          provider when those hosted features are used. Integrity status:{" "}
          {statistics?.integrity ?? "checking"}.
        </p>
      </Card>

      <div className="mt-4 flex items-center gap-2 text-[10px] text-[#737373]">
        <Bell size={14} /> Microphone and application preference controls remain UI previews; local
        data controls are active.
      </div>
    </div>
  );
}

function StorageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#383838] bg-[#343434] p-3">
      <span className="text-[10px] text-[#737373]">{label}</span>
      <strong className="mt-1 block text-xs capitalize">{value.replaceAll("_", " ")}</strong>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message;
  return fallback;
}

function discordStatusLabel(state: DiscordUiState): string {
  const labels: Record<DiscordUiState, string> = {
    not_configured: "Not configured",
    configured: "Configured — test the connection to confirm availability",
    testing: "Testing Discord connection...",
    connected: "Verified and ready for note delivery",
    failed: "Connection failed — review the error below",
    disconnecting: "Removing saved credential...",
  };
  return labels[state];
}
