import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function getLaunchAtStartup(): Promise<boolean> {
  return isEnabled();
}

export async function setLaunchAtStartup(enabled: boolean): Promise<void> {
  await (enabled ? enable() : disable());
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

export async function notifyNotesReady(title: string): Promise<void> {
  if (!(await ensureNotificationPermission())) return;
  sendNotification({ title: "Noto AI", body: `Notes ready: ${title}` });
}
