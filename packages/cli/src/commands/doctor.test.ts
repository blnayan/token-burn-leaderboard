import { describe, expect, it, vi } from "vitest";

import { runDoctor } from "./doctor.js";

describe("runDoctor", () => {
  it("prints local setup and duplicate-device warnings", async () => {
    const log = vi.fn();

    await runDoctor({
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
        recommendedCliVersion: "0.1.5",
        minimumCliVersion: "0.1.5",
        serverTime: "2026-06-03T00:00:00.000Z",
      }),
      readDevices: async () => ({
        devices: [],
        duplicateGroups: [
          {
            name: "nayan-vps",
            os: "linux",
            duplicateRows: 2,
            conflictRows: 0,
            devices: [],
          },
        ],
      }),
      log,
    });

    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "CLI version: 0.1.5.",
      "Authenticated with https://token-burn.test.",
      "Device: nayan-vps (4f43b27d-7d86-4ff8-8c98-f74158819e59).",
      "Platform: linux.",
      "Last sync: Failed - Failed providers: claude_code at 2026-06-01T00:00:00.000Z.",
      "Likely duplicate devices found. Run token-burn devices to inspect and merge.",
      "Run token-burn sync to submit usage now.",
    ]);
  });
});
