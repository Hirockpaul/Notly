export type TranscriptionLanguage = "en-US" | "hi-IN";

export interface AppPreferences {
  microphoneDeviceId: string;
  noiseReduction: boolean;
  noteNotifications: boolean;
  transcriptionLanguage: TranscriptionLanguage;
}

const STORAGE_KEY = "noto:preferences:v1";

const defaults: AppPreferences = {
  microphoneDeviceId: "default",
  noiseReduction: true,
  noteNotifications: true,
  transcriptionLanguage: "en-US",
};

export function getAppPreferences(): AppPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<AppPreferences>;
    return {
      microphoneDeviceId:
        typeof stored.microphoneDeviceId === "string"
          ? stored.microphoneDeviceId
          : defaults.microphoneDeviceId,
      noiseReduction:
        typeof stored.noiseReduction === "boolean"
          ? stored.noiseReduction
          : defaults.noiseReduction,
      noteNotifications:
        typeof stored.noteNotifications === "boolean"
          ? stored.noteNotifications
          : defaults.noteNotifications,
      transcriptionLanguage: stored.transcriptionLanguage === "hi-IN" ? "hi-IN" : "en-US",
    };
  } catch {
    return { ...defaults };
  }
}

export function updateAppPreferences(update: Partial<AppPreferences>): AppPreferences {
  const next = { ...getAppPreferences(), ...update };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("noto:preferences", { detail: next }));
  return next;
}
