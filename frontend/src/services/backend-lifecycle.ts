import { invoke } from "@tauri-apps/api/core";

import { isTauriStorage } from "./session-storage";

export type BackendPhase = "starting" | "ready" | "failed" | "stopping" | "stopped";

export interface BackendStatus {
  phase: BackendPhase;
  message: string | null;
}

export function requiresDesktopBackend(): boolean {
  return isTauriStorage();
}

export function getBackendStatus(): Promise<BackendStatus> {
  if (!requiresDesktopBackend()) return Promise.resolve({ phase: "ready", message: null });
  return invoke<BackendStatus>("backend_status");
}

export function restartBackend(): Promise<void> {
  if (!requiresDesktopBackend()) return Promise.resolve();
  return invoke("backend_restart");
}
