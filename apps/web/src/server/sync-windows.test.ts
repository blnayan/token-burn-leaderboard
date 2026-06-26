import { describe, expect, it, vi } from "vitest";
import { providers } from "@token-burn/shared";

import { buildSyncWindows, type SyncWindowsPrisma } from "./sync-windows";

describe("buildSyncWindows", () => {
  it("returns UTC until and provider-specific since dates", async () => {
    const prisma = createPrismaMock([
      { provider: "claude_code", _max: { syncedAt: new Date("2026-06-05T23:30:00.000Z") } },
      { provider: "codex", _max: { syncedAt: new Date("2026-06-06T01:15:00.000Z") } },
    ]);

    await expect(
      buildSyncWindows({
        prisma,
        memberId: "member-1",
        clientDeviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        now: () => new Date("2026-06-06T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: providers.map((provider) => {
        if (provider === "claude_code") return { provider, since: "2026-06-05" };
        if (provider === "codex") return { provider, since: "2026-06-06" };
        return { provider };
      }),
    });
  });

  it("ignores unknown providers and null syncedAt while preserving provider order", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { provider: "codex", _max: { syncedAt: null } },
      { provider: "legacy_tool", _max: { syncedAt: new Date("2026-06-05T12:00:00.000Z") } },
      { provider: "claude_code", _max: { syncedAt: new Date("2026-06-05T23:30:00.000Z") } },
    ]);
    const prisma = {
      dailyProviderUsage: {
        groupBy,
      },
    } as unknown as SyncWindowsPrisma;

    await expect(
      buildSyncWindows({
        prisma,
        memberId: "member-1",
        clientDeviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        now: () => new Date("2026-06-06T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: providers.map((provider) =>
        provider === "claude_code" ? { provider, since: "2026-06-05" } : { provider },
      ),
    });

    expect(groupBy).toHaveBeenCalledWith({
      by: ["provider"],
      where: {
        memberId: "member-1",
        device: {
          clientDeviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        },
      },
      _max: {
        syncedAt: true,
      },
    });
  });
});

function createPrismaMock(rows: Array<{ provider: string; _max: { syncedAt: Date | null } }>): SyncWindowsPrisma {
  return {
    dailyProviderUsage: {
      groupBy: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as SyncWindowsPrisma;
}
