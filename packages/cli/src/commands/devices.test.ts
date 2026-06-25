import { describe, expect, it, vi } from "vitest";

import { resolveOutputMode } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
import { createDevicesCommand, runListDevices, runMergeDevices } from "./devices.js";

describe("runListDevices", () => {
  it("requires authentication", async () => {
    await expect(runListDevices({ readConfig: async () => null })).rejects.toThrow(
      "Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate.",
    );
  });

  it("prints devices and likely duplicate groups", async () => {
    const calls: string[] = [];
    const listDevices = vi.fn().mockResolvedValue({
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

    const result = await runListDevices({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      serverClient: { listDevices, mergeDevices: vi.fn() },
      ui: createRecordingUi(calls),
    });

    expect(listDevices).toHaveBeenCalledWith({ token: "tb_secret" });
    expect(result.devices).toHaveLength(2);
    expect(result.duplicateGroups).toHaveLength(1);
    expect(calls).toContain("table:Devices:[[\"old-device\",\"Nayans-MacBook-Air.local\",\"darwin\",\"21\",\"471033315\"],[\"new-device\",\"Nayans-MacBook-Air.local\",\"darwin\",\"32\",\"2162169624\"]]");
    expect(calls).toContain("table:Likely duplicates:[[\"Nayans-MacBook-Air.local\",\"darwin\",\"21\",\"0\"]]");
    expect(calls).toContain("next:Merge suggestion: token-burn devices merge old-device new-device");
    expect(readResultCall(calls)).toMatchObject({ ok: true });
  });

  it("prints automatic conflict resolution messaging and merge suggestions for conflicted duplicate groups", async () => {
    const log = vi.fn();
    const listDevices = vi.fn().mockResolvedValue({
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
          duplicateRows: 0,
          conflictRows: 1,
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
      serverClient: { listDevices, mergeDevices: vi.fn() },
      log,
    });

    expect(log).toHaveBeenCalledWith("Likely duplicates");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Nayans-MacBook-Air.local  darwin  0           1"));
    expect(log).toHaveBeenCalledWith(
      "Conflicts will be resolved automatically by keeping the higher provider/date total.",
    );
    expect(log).toHaveBeenCalledWith("Next: Merge suggestion: token-burn devices merge old-device new-device");
  });

  it("renders JSON output when a JSON renderer is injected", async () => {
    const lines: string[] = [];
    const response = { devices: [], duplicateGroups: [] };

    const result = await runListDevices({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
      serverClient: { listDevices: vi.fn().mockResolvedValue(response), mergeDevices: vi.fn() },
      ui: createRenderer(resolveOutputMode({ flags: { json: true } }), { write: (line) => lines.push(line) }),
    });

    expect(result).toEqual(response);
    expect(lines).toEqual([JSON.stringify({ ok: true, ...response })]);
  });
});

describe("runMergeDevices", () => {
  it("posts the source and target device ids", async () => {
    const mergeDevices = vi.fn().mockResolvedValue({
      sourceDeviceId: "old-device",
      targetDeviceId: "new-device",
      deletedDuplicateRows: 21,
      movedRows: 0,
      resolvedConflictRows: 2,
      deletedSourceDevice: true,
    });
    const log = vi.fn();

    const calls: string[] = [];

    const result = await runMergeDevices({
      sourceDeviceId: "old-device",
      targetDeviceId: "new-device",
      readConfig: async () => ({ serverUrl: "https://token-burn.test/", token: "tb_secret" }),
      serverClient: { listDevices: vi.fn(), mergeDevices },
      ui: createRecordingUi(calls),
    });

    expect(mergeDevices).toHaveBeenCalledWith({
      token: "tb_secret",
      sourceDeviceId: "old-device",
      targetDeviceId: "new-device",
    });
    expect(result).toEqual({
      sourceDeviceId: "old-device",
      targetDeviceId: "new-device",
      deletedDuplicateRows: 21,
      movedRows: 0,
      resolvedConflictRows: 2,
      deletedSourceDevice: true,
    });
    expect(calls).toContain("summary:Merge complete:5");
    expect(readResultCall(calls)).toEqual({ ok: true, ...result });
    expect(log).not.toHaveBeenCalled();
  });

  it("surfaces merge failures from the server", async () => {
    await expect(
      runMergeDevices({
        sourceDeviceId: "old-device",
        targetDeviceId: "new-device",
        readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
        serverClient: {
          listDevices: vi.fn(),
          mergeDevices: async () => {
            throw new Error("Cannot merge devices with conflicting usage rows.");
          },
        },
        log: vi.fn(),
      }),
    ).rejects.toThrow("Cannot merge devices with conflicting usage rows.");
  });
});

describe("createDevicesCommand", () => {
  it("contains the merge subcommand", () => {
    const help = createDevicesCommand().helpInformation();

    expect(help).toContain("merge");
  });

  it("contains the explicit list subcommand", () => {
    const help = createDevicesCommand().helpInformation();

    expect(help).toContain("list");
  });
});

function readResultCall(calls: string[]): Record<string, unknown> {
  const result = calls.find((call) => call.startsWith("result:"));

  if (!result) throw new Error("Missing result call");

  return JSON.parse(result.slice("result:".length)) as Record<string, unknown>;
}

function createRecordingUi(calls: string[]): UiRenderer {
  return {
    intro: (title, details = []) => calls.push(`intro:${title}:${details.length}`),
    step: (id, message) => calls.push(`step:${id}:${message}`),
    success: (id, message) => calls.push(`success:${id}:${message}`),
    warning: (id, message) => calls.push(`warning:${id}:${message}`),
    info: (message) => calls.push(`info:${message}`),
    table: (title, table) => calls.push(`table:${title}:${JSON.stringify(table.rows)}`),
    summary: (title, details = []) => calls.push(`summary:${title}:${details.length}`),
    nextAction: (message) => calls.push(`next:${message}`),
    error: (error) => calls.push(`error:${error.code}:${error.message}`),
    result: (result) => calls.push(`result:${JSON.stringify(result)}`),
  };
}
