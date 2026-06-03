import { describe, expect, it } from "vitest";

import {
  buildDeviceDuplicateGroups,
  mergeMemberDevices,
  planDeviceUsageMerge,
} from "./devices";

describe("buildDeviceDuplicateGroups", () => {
  it("groups same-name same-os devices with identical overlapping usage", () => {
    const groups = buildDeviceDuplicateGroups([
      {
        id: "old-device",
        name: "Nayans-MacBook-Air.local",
        os: "darwin",
        firstSeenAt: "2026-06-03T15:23:14.634Z",
        lastSeenAt: "2026-06-03T15:23:13.475Z",
        dailyRows: 1,
        totalTokens: "100",
        usageRows: [{ id: "old-row", provider: "codex", date: "2026-06-01", totalTokens: 100n }],
      },
      {
        id: "new-device",
        name: "Nayans-MacBook-Air.local",
        os: "darwin",
        firstSeenAt: "2026-06-03T15:47:05.928Z",
        lastSeenAt: "2026-06-03T15:47:05.239Z",
        dailyRows: 2,
        totalTokens: "300",
        usageRows: [
          { id: "new-row", provider: "codex", date: "2026-06-01", totalTokens: 100n },
          { id: "claude-row", provider: "claude_code", date: "2026-06-01", totalTokens: 200n },
        ],
      },
    ]);

    expect(groups).toEqual([
      {
        name: "Nayans-MacBook-Air.local",
        os: "darwin",
        duplicateRows: 1,
        conflictRows: 0,
        devices: [
          {
            id: "old-device",
            name: "Nayans-MacBook-Air.local",
            os: "darwin",
            dailyRows: 1,
            totalTokens: "100",
            firstSeenAt: "2026-06-03T15:23:14.634Z",
            lastSeenAt: "2026-06-03T15:23:13.475Z",
          },
          {
            id: "new-device",
            name: "Nayans-MacBook-Air.local",
            os: "darwin",
            dailyRows: 2,
            totalTokens: "300",
            firstSeenAt: "2026-06-03T15:47:05.928Z",
            lastSeenAt: "2026-06-03T15:47:05.239Z",
          },
        ],
      },
    ]);
  });
});

describe("planDeviceUsageMerge", () => {
  it("deletes identical source rows and moves non-conflicting source rows", () => {
    const plan = planDeviceUsageMerge({
      sourceRows: [
        { id: "duplicate-source", provider: "codex", date: "2026-06-01", totalTokens: 100n },
        { id: "unique-source", provider: "claude_code", date: "2026-06-01", totalTokens: 200n },
      ],
      targetRows: [{ id: "duplicate-target", provider: "codex", date: "2026-06-01", totalTokens: 100n }],
    });

    expect(plan).toEqual({
      duplicateSourceRowIds: ["duplicate-source"],
      movableSourceRowIds: ["unique-source"],
      conflicts: [],
    });
  });

  it("reports conflicts when provider/date totals differ", () => {
    const plan = planDeviceUsageMerge({
      sourceRows: [{ id: "source-row", provider: "codex", date: "2026-06-01", totalTokens: 100n }],
      targetRows: [{ id: "target-row", provider: "codex", date: "2026-06-01", totalTokens: 150n }],
    });

    expect(plan.conflicts).toEqual([
      {
        provider: "codex",
        date: "2026-06-01",
        sourceTotalTokens: "100",
        targetTotalTokens: "150",
      },
    ]);
  });
});

describe("mergeMemberDevices", () => {
  it("refuses to merge devices with conflicting provider/date rows", async () => {
    const prisma = {
      device: {
        findMany: async () => [
          { id: "source", memberId: "member", name: "Mac", os: "darwin" },
          { id: "target", memberId: "member", name: "Mac", os: "darwin" },
        ],
      },
      dailyProviderUsage: {
        findMany: async ({ where }: { where: { deviceId: string } }) =>
          where.deviceId === "source"
            ? [{ id: "source-row", provider: "codex", date: new Date("2026-06-01T00:00:00.000Z"), totalTokens: 100n }]
            : [{ id: "target-row", provider: "codex", date: new Date("2026-06-01T00:00:00.000Z"), totalTokens: 150n }],
      },
    };

    await expect(
      mergeMemberDevices({
        prisma,
        memberId: "member",
        sourceDeviceId: "source",
        targetDeviceId: "target",
      }),
    ).rejects.toThrow("Cannot merge devices with conflicting usage rows.");
  });
});
