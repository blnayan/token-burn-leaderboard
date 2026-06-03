import { describe, expect, it, vi } from "vitest";

import { createDevicesCommand, runListDevices, runMergeDevices } from "./devices.js";

describe("runListDevices", () => {
  it("requires authentication", async () => {
    await expect(runListDevices({ readConfig: async () => null })).rejects.toThrow(
      "Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate.",
    );
  });

  it("prints devices and likely duplicate groups", async () => {
    const log = vi.fn();
    const getJson = vi.fn().mockResolvedValue({
      devices: [
        {
          id: "old-device",
          name: "Nayans-MacBook-Air.local",
          os: "darwin",
          firstSeenAt: "2026-06-03T15:23:14.634Z",
          lastSeenAt: "2026-06-03T15:23:13.475Z",
          dailyRows: 21,
          totalTokens: "471033315",
        },
        {
          id: "new-device",
          name: "Nayans-MacBook-Air.local",
          os: "darwin",
          firstSeenAt: "2026-06-03T15:47:05.928Z",
          lastSeenAt: "2026-06-03T15:47:05.239Z",
          dailyRows: 32,
          totalTokens: "2162169624",
        },
      ],
      duplicateGroups: [
        {
          name: "Nayans-MacBook-Air.local",
          os: "darwin",
          duplicateRows: 21,
          conflictRows: 0,
          devices: [
            {
              id: "old-device",
              name: "Nayans-MacBook-Air.local",
              os: "darwin",
              firstSeenAt: "2026-06-03T15:23:14.634Z",
              lastSeenAt: "2026-06-03T15:23:13.475Z",
              dailyRows: 21,
              totalTokens: "471033315",
            },
            {
              id: "new-device",
              name: "Nayans-MacBook-Air.local",
              os: "darwin",
              firstSeenAt: "2026-06-03T15:47:05.928Z",
              lastSeenAt: "2026-06-03T15:47:05.239Z",
              dailyRows: 32,
              totalTokens: "2162169624",
            },
          ],
        },
      ],
    });

    await runListDevices({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      getJson,
      log,
    });

    expect(getJson).toHaveBeenCalledWith("https://token-burn.test/api/cli/devices", "tb_secret");
    expect(log).toHaveBeenCalledWith("Devices:");
    expect(log).toHaveBeenCalledWith("old-device  Nayans-MacBook-Air.local  darwin  21 rows  471033315 tokens");
    expect(log).toHaveBeenCalledWith("new-device  Nayans-MacBook-Air.local  darwin  32 rows  2162169624 tokens");
    expect(log).toHaveBeenCalledWith("Likely duplicates:");
    expect(log).toHaveBeenCalledWith("Nayans-MacBook-Air.local / darwin: 21 duplicate rows, 0 conflicts");
    expect(log).toHaveBeenCalledWith("Merge suggestion: token-burn devices merge old-device new-device");
  });
});

describe("runMergeDevices", () => {
  it("posts the source and target device ids", async () => {
    const postJson = vi.fn().mockResolvedValue({
      sourceDeviceId: "old-device",
      targetDeviceId: "new-device",
      deletedDuplicateRows: 21,
      movedRows: 0,
      deletedSourceDevice: true,
    });
    const log = vi.fn();

    await runMergeDevices({
      sourceDeviceId: "old-device",
      targetDeviceId: "new-device",
      readConfig: async () => ({ serverUrl: "https://token-burn.test/", token: "tb_secret" }),
      postJson,
      log,
    });

    expect(postJson).toHaveBeenCalledWith(
      "https://token-burn.test/api/cli/devices/merge",
      { sourceDeviceId: "old-device", targetDeviceId: "new-device" },
      "tb_secret",
    );
    expect(log).toHaveBeenCalledWith("Deleted duplicate rows: 21");
    expect(log).toHaveBeenCalledWith("Moved rows: 0");
    expect(log).toHaveBeenCalledWith("Deleted source device: yes");
  });
});

describe("createDevicesCommand", () => {
  it("contains the merge subcommand", () => {
    const help = createDevicesCommand().helpInformation();

    expect(help).toContain("merge");
  });
});
