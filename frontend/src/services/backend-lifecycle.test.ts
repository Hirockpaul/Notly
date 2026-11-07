import { afterEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { getBackendStatus, requiresDesktopBackend, restartBackend } from "./backend-lifecycle";

afterEach(() => {
  vi.unstubAllGlobals();
  invoke.mockReset();
});

describe("backend lifecycle runtime gating", () => {
  it("bypasses desktop readiness without invoking Tauri in a browser", async () => {
    vi.stubGlobal("window", {});
    await expect(getBackendStatus()).resolves.toEqual({ phase: "ready", message: null });
    await restartBackend();
    expect(requiresDesktopBackend()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses authenticated desktop lifecycle commands in Tauri", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke
      .mockResolvedValueOnce({ phase: "starting", message: null })
      .mockResolvedValueOnce(undefined);
    await expect(getBackendStatus()).resolves.toEqual({ phase: "starting", message: null });
    await restartBackend();
    expect(invoke.mock.calls).toEqual([["backend_status"], ["backend_restart"]]);
  });
});
