import {
  Bell,
  Check,
  Database,
  Download,
  Mic,
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
import { DiscordIcon } from "../../components/icons/DiscordIcon";
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
import { useAudioInputPreview } from "../../hooks/useAudioInputPreview";
import { getAppPreferences, updateAppPreferences } from "../../services/app-preferences";
import {
  ensureNotificationPermission,
  getLaunchAtStartup,
  setLaunchAtStartup as updateLaunchAtStartup,
} from "../../services/native-preferences";

interface SettingRowProps {
  title: string;
  description: string;
  children: ReactNode;
}

type DiscordUiState =
  "not_configured" | "configured" | "testing" | "connected" | "failed" | "disconnecting";

function SettingRow({ title, description, children }: SettingRowProps) {
  return (
    <div className="flex min-h-17 items-center justify-between gap-6 border-t border-[#383838] py-4 first:border-t-0">
      <div className="min-w-0">
        <strong className="text-[13px] font-medium text-[#F5F5F5]">{title}</strong>
        <p className="mt-1 text-xs leading-5 text-[#737373]">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const [preferences, setPreferences] = useState(getAppPreferences);
  const { microphoneDeviceId, noiseReduction, noteNotifications: notifications } = preferences;
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const microphone = useAudioInputPreview(microphoneDeviceId, noiseReduction);
  const [discordState, setDiscordState] = useState<DiscordUiState>("not_configured");
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [showDiscordForm, setShowDiscordForm] = useState(false);
  const [webhookDraft, setWebhookDraft] = useState("");
  const [lastDelivery, setLastDelivery] = useState<DiscordDeliveryActivity | null>(() =>
    getLastDiscordDelivery(),
  );
  const [statistics, setStatistics] = useState<StorageStatistics | null>(null);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [discordNotice, setDiscordNotice] = useState<string | null>(null);
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
    void getLaunchAtStartup()
      .then((enabled) => {
        if (active) setLaunchAtStartup(enabled);
      })
      .catch(() => {
        if (active) setPreferenceError("Launch-at-startup status is unavailable.");
      });
    return () => {
      active = false;
    };
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
      setDiscordError("Enter a Discord incoming webhook URL.");
      return;
    }
    setOperation("discord");
    setDiscordError(null);
    setDiscordNotice(null);
    setDiscordState("testing");
    try {
      await configureDiscord(value);
      setDiscordConfigured(true);
      setDiscordState("connected");
      setWebhookDraft("");
      setShowDiscordForm(false);
      setDiscordNotice("Discord webhook verified and stored securely.");
    } catch (error) {
      setDiscordState("failed");
      setDiscordError(errorMessage(error, "Discord configuration failed."));
    } finally {
      setOperation(null);
    }
  };

  const removeWebhook = async () => {
    if (!window.confirm("Disconnect Discord and delete the saved webhook credential?")) return;
    setDiscordState("disconnecting");
    setDiscordError(null);
    setDiscordNotice(null);
    try {
      await disconnectDiscord();
      setDiscordConfigured(false);
      setDiscordState("not_configured");
      setWebhookDraft("");
      setShowDiscordForm(false);
      setDiscordNotice("Discord disconnected.");
    } catch (error) {
      setDiscordState("failed");
      setDiscordError(errorMessage(error, "Discord disconnect failed."));
    }
  };

  const testWebhook = async () => {
    setDiscordState("testing");
    setDiscordError(null);
    setDiscordNotice(null);
    try {
      await testDiscord();
      setDiscordState("connected");
      setDiscordNotice("Discord connection verified.");
    } catch (error) {
      setDiscordState("failed");
      setDiscordError(errorMessage(error, "Discord test failed."));
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
    <div className="mx-auto max-w-360 px-[clamp(24px,4vw,64px)] pt-11 pb-16">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <span className="text-xs font-medium text-[#737373]">Preferences</span>
          <h1 className="mt-2 text-[clamp(28px,3vw,32px)] leading-tight font-semibold tracking-[-0.03em]">
            Settings
          </h1>
          <p className="mt-3 text-[13px] leading-5 text-[#A3A3A3]">
            Configure how Noto listens, processes, and delivers your notes.
          </p>
        </div>
        <span className="mt-1 flex shrink-0 items-center gap-2 rounded-full border border-[#383838] bg-[#252525] px-3 py-2 text-[11px] text-[#A3A3A3]">
          <Check className="text-[#22C55E]" size={13} /> Saved locally
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-6 transition-colors duration-200 hover:border-[#444444]">
          <div className="mb-4 flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-[10px] bg-[#343434] text-[#F5F5F5]">
              <Mic size={18} strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-[15px] font-medium">Microphone</h2>
              <p className="mt-1 text-xs text-[#737373]">
                Choose the audio input used for conversations.
              </p>
            </div>
          </div>
          <SettingRow description="System default input device" title="Input source">
            <select
              className="rounded-[9px] border border-[#383838] bg-[#2D2D2D] px-3 py-2 text-xs text-[#F5F5F5] outline-none focus:border-[#3B82F6]"
              onChange={(event) => {
                const next = updateAppPreferences({ microphoneDeviceId: event.target.value });
                setPreferences(next);
              }}
              onFocus={() => void microphone.refreshDevices()}
              value={microphoneDeviceId}
            >
              <option value="default">System default microphone</option>
              {microphone.devices
                .filter((device) => device.deviceId !== "default")
                .map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
            </select>
          </SettingRow>
          <SettingRow
            description={microphone.error ?? "Start a private preview to verify the selected input"}
            title="Input level"
          >
            <div className="flex items-center gap-2">
              <div
                className="flex h-8 items-center gap-1 rounded-lg bg-[#202020] px-2"
                aria-label="Live input level"
              >
                {[30, 55, 74, 48, 66, 38, 58, 44].map((height, index) => (
                  <span
                    className="w-1 rounded-full bg-[#3B82F6]/80"
                    key={index}
                    style={{ height: `${Math.max(8, height * microphone.level)}%` }}
                  />
                ))}
              </div>
              <Button
                onClick={() => void microphone.startPreview()}
                size="small"
                variant="secondary"
              >
                Test input
              </Button>
            </div>
          </SettingRow>
        </Card>

        <Card className="p-6 transition-colors duration-200 hover:border-[#444444]">
          <div className="mb-4 flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-[10px] border border-[#383838] bg-[#2D2D2D] text-[#A3A3A3]">
              <SlidersHorizontal size={19} />
            </div>
            <div>
              <h2 className="text-[15px] font-medium">Audio processing</h2>
              <p className="mt-1 text-xs text-[#737373]">Tune how Noto handles captured audio.</p>
            </div>
          </div>
          <SettingRow
            description="Reduce steady background sound during capture"
            title="Noise reduction"
          >
            <Toggle
              checked={noiseReduction}
              label="Toggle noise reduction"
              onChange={(enabled) =>
                setPreferences(updateAppPreferences({ noiseReduction: enabled }))
              }
            />
          </SettingRow>
        </Card>

        <Card className="p-6 transition-colors duration-200 hover:border-[#444444]">
          <div className="mb-5 flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-[10px] border border-[#383838] bg-[#2D2D2D] text-[#A3A3A3]">
              <DiscordIcon size={19} />
            </div>
            <div>
              <h2 className="text-[15px] font-medium">Discord delivery</h2>
              <p className="mt-1 text-xs text-[#737373]">
                Send completed notes to a private Discord channel.
              </p>
            </div>
          </div>
          <div className="rounded-[10px] border border-[#383838] bg-[#202020]">
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`size-2.5 shrink-0 rounded-full transition-[background-color,box-shadow] duration-200 ${discordState === "connected" ? "bg-[#22C55E] shadow-[0_0_0_3px_rgb(34_197_94/15%),0_0_10px_rgb(34_197_94/45%)]" : discordState === "failed" ? "bg-[#EF4444]" : "bg-[#737373]"}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <strong className="text-[13px] font-medium">
                    {discordState === "connected" ? "Discord connected" : "Discord webhook"}
                  </strong>
                  <p className="mt-1 text-xs leading-5 text-[#737373]">
                    {discordStatusLabel(discordState)}
                  </p>
                </div>
              </div>
              {!discordConfigured ? (
                <Button
                  disabled={discordState === "testing"}
                  onClick={() => setShowDiscordForm(true)}
                  size="small"
                >
                  Configure
                </Button>
              ) : null}
            </div>
          </div>
          {showDiscordForm ? (
            <div className="mt-3 rounded-[10px] border border-[#383838] bg-[#2D2D2D] p-4">
              <label className="text-xs font-medium text-[#A3A3A3]" htmlFor="discord-webhook">
                Discord webhook URL
              </label>
              <input
                id="discord-webhook"
                autoComplete="off"
                className="mt-2 w-full rounded-[9px] border border-[#383838] bg-[#202020] px-3 py-2.5 text-xs text-[#F5F5F5] outline-none transition-colors duration-150 placeholder:text-[#737373] hover:border-[#4A4A4A] focus:border-[#3B82F6] focus:ring-2 focus:ring-[#3B82F6]/20"
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
                    setDiscordError(null);
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={discordState === "testing" || discordState === "disconnecting"}
                onClick={() => void testWebhook()}
                size="small"
              >
                {discordState === "testing" ? "Testing..." : "Test connection"}
              </Button>
              <Button
                disabled={discordState === "testing" || discordState === "disconnecting"}
                onClick={() => {
                  setWebhookDraft("");
                  setShowDiscordForm(true);
                  setDiscordError(null);
                  setDiscordNotice(null);
                }}
                size="small"
                variant="ghost"
              >
                Change webhook
              </Button>
              <Button
                disabled={discordState === "testing" || discordState === "disconnecting"}
                onClick={() => void removeWebhook()}
                size="small"
                variant="ghost"
              >
                {discordState === "disconnecting" ? "Disconnecting..." : "Disconnect"}
              </Button>
            </div>
          ) : null}
          {discordError ? (
            <p className="mt-3 text-xs leading-5 text-[#EF4444]" role="alert">
              {discordError}
            </p>
          ) : null}
          {discordNotice ? (
            <p className="mt-3 text-xs leading-5 text-[#22C55E]" role="status">
              {discordNotice}
            </p>
          ) : null}
          <div className="mt-4 border-t border-[#383838] pt-4">
            <span className="text-[11px] font-medium tracking-wide text-[#737373] uppercase">
              Latest successful delivery
            </span>
            {lastDelivery?.kind === "success" ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-[#22C55E]">
                <Check size={13} /> {lastDelivery.message} ·{" "}
                {new Date(lastDelivery.at).toLocaleString()}
              </p>
            ) : (
              <p className="mt-2 text-xs text-[#737373]">No successful deliveries yet.</p>
            )}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#737373]">
            The webhook stays in your operating system credential vault and is never shown or
            written to logs.
          </p>
        </Card>

        <Card className="p-6 transition-colors duration-200 hover:border-[#444444]">
          <div className="mb-4 flex items-center gap-3.5">
            <div className="flex size-10 items-center justify-center rounded-[10px] border border-[#383838] bg-[#2D2D2D] text-[#A3A3A3]">
              <Volume2 size={19} />
            </div>
            <div>
              <h2 className="text-[15px] font-medium">Application</h2>
              <p className="mt-1 text-xs text-[#737373]">Control Noto's desktop behavior.</p>
            </div>
          </div>
          <SettingRow description="Open Noto when your computer starts" title="Launch at startup">
            <Toggle
              checked={launchAtStartup}
              label="Toggle launch at startup"
              onChange={(enabled) => {
                setPreferenceError(null);
                void updateLaunchAtStartup(enabled)
                  .then(() => setLaunchAtStartup(enabled))
                  .catch(() => setPreferenceError("Could not update launch-at-startup."));
              }}
            />
          </SettingRow>
          <SettingRow
            description="Show a notification when a note is ready"
            title="Note notifications"
          >
            <Toggle
              checked={notifications}
              label="Toggle note notifications"
              onChange={(enabled) => {
                setPreferenceError(null);
                if (!enabled) {
                  setPreferences(updateAppPreferences({ noteNotifications: false }));
                  return;
                }
                void ensureNotificationPermission()
                  .then((granted) => {
                    if (!granted) throw new Error("permission denied");
                    setPreferences(updateAppPreferences({ noteNotifications: true }));
                  })
                  .catch(() => setPreferenceError("Notification permission was not granted."));
              }}
            />
          </SettingRow>
          {preferenceError ? (
            <p className="mt-2 text-xs text-[#EF4444]">{preferenceError}</p>
          ) : null}
        </Card>
      </div>

      <Card className="mt-4 p-6 transition-colors duration-200 hover:border-[#444444]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[10px] border border-[#383838] bg-[#2D2D2D] text-[#A3A3A3]">
              <Database size={19} />
            </div>
            <div>
              <h2 className="text-[15px] font-medium">Local data and privacy</h2>
              <p className="mt-1 text-xs text-[#737373]">
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
        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
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
        <p className="mt-4 text-[11px] leading-5 text-[#737373]">
          Local transcript and notes content is not encrypted at rest. SQLite storage is local only;
          audio may still be sent to NVIDIA for ASR and transcript text to the configured notes
          provider when those hosted features are used. Integrity status:{" "}
          {statistics?.integrity ?? "checking"}.
        </p>
      </Card>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-[#737373]">
        <Bell size={14} /> Microphone and application preference controls remain UI previews; local
        data controls are active.
      </div>
    </div>
  );
}

function StorageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-[#383838] bg-[#202020] p-3.5">
      <span className="text-[11px] text-[#737373]">{label}</span>
      <strong className="mt-1.5 block text-[13px] font-medium capitalize">
        {value.replaceAll("_", " ")}
      </strong>
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
