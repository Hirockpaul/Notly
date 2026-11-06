import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  initializeSessionStorage: vi.fn(() => Promise.resolve()),
  states: [] as unknown[],
  stateIndex: 0,
}));

vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => void effect(),
  useState: <T,>(initial: T) => {
    const index = mocks.stateIndex++;
    if (mocks.states[index] === undefined) mocks.states[index] = initial;
    return [mocks.states[index] as T, (value: T) => (mocks.states[index] = value)] as const;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("./services/session-storage", () => ({
  initializeSessionStorage: mocks.initializeSessionStorage,
  isTauriStorage: () => false,
}));
vi.mock("./layouts/AppShell", () => ({ AppShell: () => null }));
vi.mock("./features/overview/OverviewPage", () => ({ OverviewPage: () => null }));
vi.mock("./features/notes/NotesPage", () => ({ NotesPage: () => null }));
vi.mock("./features/settings/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./features/transcription/RecordingPage", () => ({ RecordingPage: () => null }));

import { App } from "./App";

describe("App browser startup", () => {
  beforeEach(() => {
    mocks.states.length = 0;
    mocks.stateIndex = 0;
    mocks.invoke.mockReset();
    mocks.initializeSessionStorage.mockClear();
  });

  it("initializes browser storage and renders the application without lifecycle IPC", async () => {
    let rendered = App();
    expect(rendered.type).toBe("main");
    expect(mocks.initializeSessionStorage).toHaveBeenCalledOnce();

    await Promise.resolve();
    mocks.stateIndex = 0;
    rendered = App();

    expect(rendered.type).not.toBe("main");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
