import { describe, expect, it, vi } from "vitest";

import type { UiRenderer } from "../ui/types.js";
import { cliVersion } from "../version.js";
import { runDoctor } from "./doctor.js";

describe("runDoctor", () => {
  it("renders doctor with the provided renderer", async () => {
    const calls: string[] = [];

    await runDoctor({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      platform: "linux",
      readHealth: async () => ({ requiredCliVersion: cliVersion, serverTime: "2026-06-03T00:00:00.000Z" }),
      readDevices: async () => ({
        duplicateGroups: [{ name: "nayan-vps", os: "linux", duplicateRows: 2, conflictRows: 0 }],
      }),
      ui: {
        intro: (title, details = []) => calls.push(`intro:${title}:${details.length}`),
        step: () => undefined,
        success: (_id, message) => calls.push(`success:${message}`),
        warning: (_id, message) => calls.push(`warning:${message}`),
        info: (message) => calls.push(`info:${message}`),
        table: () => undefined,
        summary: () => undefined,
        nextAction: (message) => calls.push(`next:${message}`),
        error: () => undefined,
        result: (result) => calls.push(`result:${JSON.stringify(result)}`),
      },
      log: () => undefined,
    });

    expect(calls).toContain("intro:Token Burn doctor:2");
    expect(calls).toContain("warning:Likely duplicate devices found. Run token-burn devices to inspect and merge.");
    expect(calls).toContain("next:Run token-burn sync to submit usage now.");
  });

  it("renders local setup and duplicate-device warnings", async () => {
    const calls: string[] = [];
    const readDevices = vi.fn(async () => ({
      duplicateGroups: [
        {
          name: "nayan-vps",
          os: "linux",
          duplicateRows: 2,
          conflictRows: 0,
        },
      ],
    }));

    const result = await runDoctor({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        lastSync: {
          ok: false,
          message: "Failed providers: claude_code",
          at: "2026-06-01T00:00:00.000Z",
        },
      }),
      platform: "linux",
      readHealth: async () => ({
        requiredCliVersion: cliVersion,
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      readDevices,
      ui: createRecordingUi(calls),
    });

    expect(result.device).toEqual({ id: "4f43b27d-7d86-4ff8-8c98-f74158819e59", name: "nayan-vps" });
    expect(result.duplicateDeviceGroups).toEqual([
      {
        name: "nayan-vps",
        os: "linux",
        duplicateRows: 2,
        conflictRows: 0,
      },
    ]);
    expect(calls).toContain("intro:Token Burn doctor:2");
    expect(calls).toContain("success:auth:Authenticated with https://token-burn.test");
    expect(calls).toContain("info:Device: nayan-vps (4f43b27d-7d86-4ff8-8c98-f74158819e59)");
    expect(calls).toContain("info:Last sync: Failed - Failed providers: claude_code at 2026-06-01T00:00:00.000Z");
    expect(calls).toContain("warning:devices:Likely duplicate devices found. Run token-burn devices to inspect and merge.");
    expect(calls).toContain("next:Run token-burn sync to submit usage now.");
    expect(readDevices).toHaveBeenCalledWith("https://token-burn.test", "tb_secret");
  });

  it("does not call server readers without config", async () => {
    const readHealth = vi.fn();
    const readDevices = vi.fn();

    await runDoctor({
      readConfig: async () => null,
      readHealth,
      readDevices,
      ui: createRecordingUi([]),
    });

    expect(readHealth).not.toHaveBeenCalled();
    expect(readDevices).not.toHaveBeenCalled();
  });

  it("does not call server readers when unauthenticated", async () => {
    const readHealth = vi.fn();
    const readDevices = vi.fn();

    await runDoctor({
      readConfig: async () => ({ serverUrl: "https://token-burn.test" }),
      readHealth,
      readDevices,
      ui: createRecordingUi([]),
    });

    expect(readHealth).not.toHaveBeenCalled();
    expect(readDevices).not.toHaveBeenCalled();
  });

  it("reports tokenless last sync and returns it for renderers", async () => {
    const calls: string[] = [];

    const result = await runDoctor({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
      }),
      platform: "linux",
      ui: createRecordingUi(calls),
    });

    expect(calls).toContain("warning:auth:Not authenticated");
    expect(calls).toContain("info:Remembered server: https://token-burn.test");
    expect(calls).toContain("info:Last sync: OK - Submitted 42 usage rows. at 2026-06-01T00:00:00.000Z");
    expect(calls).toContain("next:Run token-burn sync to submit usage now.");
    expect(result).toEqual({
      authenticated: false,
      cliVersion,
      duplicateDeviceGroups: [],
      lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
      platform: "linux",
      rememberedServer: "https://token-burn.test",
      serverUrl: "https://token-burn.test",
    });
  });

  it("keeps running when health check fails", async () => {
    const calls: string[] = [];

    const result = await runDoctor({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      platform: "linux",
      readHealth: async () => {
        throw new Error("offline");
      },
      readDevices: async () => ({ duplicateGroups: [] }),
      ui: createRecordingUi(calls),
    });

    expect(result.serverHealthError).toBe("offline");
    expect(calls).toContain("success:auth:Authenticated with https://token-burn.test");
    expect(calls).toContain("warning:health:Server health check failed: offline");
    expect(calls).toContain("next:Run token-burn sync to submit usage now.");
  });

  it("keeps running when device check fails", async () => {
    const calls: string[] = [];

    const result = await runDoctor({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      platform: "linux",
      readHealth: async () => ({
        requiredCliVersion: cliVersion,
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      readDevices: async () => {
        throw new Error("bad response");
      },
      ui: createRecordingUi(calls),
    });

    expect(result.deviceCheckError).toBe("bad response");
    expect(calls).toContain("success:auth:Authenticated with https://token-burn.test");
    expect(calls).toContain("warning:devices:Device check failed: bad response");
    expect(calls).toContain("next:Run token-burn sync to submit usage now.");
  });

  it("returns structured diagnostics for renderers", async () => {
    const result = await runDoctor({
      readConfig: async () => ({
        serverUrl: "https://token-burn.test",
        token: "tb_secret",
        deviceId: "device-1",
        deviceName: "nayan-vps",
      }),
      platform: "linux",
      readHealth: async () => ({ requiredCliVersion: cliVersion, serverTime: "2026-06-03T00:00:00.000Z" }),
      readDevices: async () => ({
        duplicateGroups: [{ name: "nayan-vps", os: "linux", duplicateRows: 2, conflictRows: 0 }],
      }),
      ui: createRecordingUi([]),
    });

    expect(result).toEqual({
      authenticated: true,
      cliVersion,
      device: { id: "device-1", name: "nayan-vps" },
      duplicateDeviceGroups: [{ name: "nayan-vps", os: "linux", duplicateRows: 2, conflictRows: 0 }],
      platform: "linux",
      serverUrl: "https://token-burn.test",
    });
  });
});

function createRecordingUi(calls: string[]): UiRenderer {
  return {
    intro: (title, details = []) => calls.push(`intro:${title}:${details.length}`),
    step: (id, message) => calls.push(`step:${id}:${message}`),
    success: (id, message) => calls.push(`success:${id}:${message}`),
    warning: (id, message) => calls.push(`warning:${id}:${message}`),
    info: (message) => calls.push(`info:${message}`),
    table: (title) => calls.push(`table:${title}`),
    summary: (title, details = []) => calls.push(`summary:${title}:${details.length}`),
    nextAction: (message) => calls.push(`next:${message}`),
    error: (error) => calls.push(`error:${error.code}:${error.message}`),
    result: (result) => calls.push(`result:${JSON.stringify(result)}`),
  };
}
