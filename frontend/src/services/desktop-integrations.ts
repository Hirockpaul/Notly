import { invoke } from "@tauri-apps/api/core";
import type { NotesDocument } from "./audio-backend-client";
import { isTauriStorage } from "./session-storage";

export interface DiscordDeliveryActivity {
  kind: "success" | "error";
  message: string;
  at: string;
}
let lastDiscordActivity: DiscordDeliveryActivity | null = null;
export function recordDiscordDelivery(activity: Omit<DiscordDeliveryActivity, "at">) {
  lastDiscordActivity = { ...activity, at: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent("noto:discord-delivery", { detail: lastDiscordActivity }));
}
export function getLastDiscordDelivery() {
  return lastDiscordActivity;
}

export interface BackupPreview {
  createdAt: string;
  backupVersion: number;
  recordingCount: number;
  notesCount: number;
}
export interface RestoreResult {
  imported: number;
  skippedExisting: number;
  integrity: string;
}
function requireDesktop() {
  if (!isTauriStorage()) throw new Error("This action is available in the Noto AI desktop app.");
}
export async function createBackup() {
  requireDesktop();
  return invoke<string | null>("create_backup");
}
export async function selectBackup() {
  requireDesktop();
  return invoke<BackupPreview | null>("select_backup_for_restore");
}
export async function restoreBackup(replaceAll = false) {
  requireDesktop();
  return invoke<RestoreResult>("restore_selected_backup", { replaceAll });
}
export async function getDiscordStatus() {
  if (!isTauriStorage()) return false;
  return (await invoke<{ connected: boolean }>("discord_status")).connected;
}
export async function configureDiscord(webhookUrl: string) {
  requireDesktop();
  await invoke("configure_discord", { webhookUrl });
}
export async function testDiscord() {
  requireDesktop();
  await invoke("test_discord");
}
export async function disconnectDiscord() {
  requireDesktop();
  await invoke("disconnect_discord");
}
export async function sendNotesToDiscord(delivery: {
  title: string;
  createdAt: string;
  durationSeconds: number;
  notes: NotesDocument;
  startAt?: number;
}) {
  requireDesktop();
  return invoke<{ messagesSent: number; totalMessages: number }>("send_notes_to_discord", {
    delivery,
  });
}
