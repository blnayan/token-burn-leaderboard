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

  it("treats different overlapping totals as automatically mergeable conflict rows", () => {
    const groups = buildDeviceDuplicateGroups([
      {
        id: "old-device",
        name: "vps",
        os: "linux",
        firstSeenAt: "2026-06-03T15:23:14.634Z",
        lastSeenAt: "2026-06-03T15:23:13.475Z",
        dailyRows: 1,
        totalTokens: "31450563",
        usageRows: [{ id: "old-row", provider: "codex", date: "2026-06-03", totalTokens: 31_450_563n }],
      },
      {
        id: "new-device",
        name: "vps",
        os: "linux",
        firstSeenAt: "2026-06-03T22:11:44.630Z",
        lastSeenAt: "2026-06-03T22:11:43.895Z",
        dailyRows: 1,
        totalTokens: "190350537",
        usageRows: [{ id: "new-row", provider: "codex", date: "2026-06-03", totalTokens: 190_350_537n }],
      },
    ]);

    expect(groups).toMatchObject([
      {
        name: "vps",
        os: "linux",
        duplicateRows: 0,
        conflictRows: 1,
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
      lowerConflictSourceRowIds: [],
      replacedTargetRowIds: [],
      resolvedConflictRows: [],
    });
  });

  it("resolves differing provider/date totals by keeping the higher target row", () => {
    const plan = planDeviceUsageMerge({
      sourceRows: [{ id: "source-row", provider: "codex", date: "2026-06-01", totalTokens: 100n }],
      targetRows: [{ id: "target-row", provider: "codex", date: "2026-06-01", totalTokens: 150n }],
    });

    expect(plan).toEqual({
      duplicateSourceRowIds: [],
      movableSourceRowIds: [],
      lowerConflictSourceRowIds: ["source-row"],
      replacedTargetRowIds: [],
      resolvedConflictRows: [
        {
          provider: "codex",
          date: "2026-06-01",
          keptDevice: "target",
          keptTotalTokens: "150",
          discardedTotalTokens: "100",
        },
      ],
    });
  });

  it("resolves differing provider/date totals by keeping the higher source row", () => {
    const plan = planDeviceUsageMerge({
      sourceRows: [{ id: "source-row", provider: "codex", date: "2026-06-01", totalTokens: 200n }],
      targetRows: [{ id: "target-row", provider: "codex", date: "2026-06-01", totalTokens: 150n }],
    });

    expect(plan).toEqual({
      duplicateSourceRowIds: [],
      movableSourceRowIds: ["source-row"],
      lowerConflictSourceRowIds: [],
      replacedTargetRowIds: ["target-row"],
      resolvedConflictRows: [
        {
          provider: "codex",
          date: "2026-06-01",
          keptDevice: "source",
          keptTotalTokens: "200",
          discardedTotalTokens: "150",
        },
      ],
    });
  });
});

describe("mergeMemberDevices", () => {
  it("resolves conflicts by deleting lower source rows when the target total is higher", async () => {
    const deletedWhereArgs: unknown[] = [];
    const deletedDevices: unknown[] = [];
    const prisma = {
      device: {
        findMany: async () => [
          { id: "source", memberId: "member", name: "Mac", os: "darwin" },
          { id: "target", memberId: "member", name: "Mac", os: "darwin" },
        ],
        delete: async (args: unknown) => {
          deletedDevices.push(args);
        },
      },
      dailyProviderUsage: {
        findMany: async ({ where }: { where: { deviceId: string } }) =>
          where.deviceId === "source"
            ? [{ id: "source-row", provider: "codex", date: new Date("2026-06-01T00:00:00.000Z"), totalTokens: 100n }]
            : [{ id: "target-row", provider: "codex", date: new Date("2026-06-01T00:00:00.000Z"), totalTokens: 150n }],
        deleteMany: async (args: unknown) => {
          deletedWhereArgs.push(args);
          return { count: 1 };
        },
        updateMany: async () => ({ count: 0 }),
      },
      dailyModelUsage: {
        updateMany: async () => ({ count: 0 }),
      },
    };

    await expect(
      mergeMemberDevices({
        prisma,
        memberId: "member",
        sourceDeviceId: "source",
        targetDeviceId: "target",
      }),
    ).resolves.toEqual({
      sourceDeviceId: "source",
      targetDeviceId: "target",
      deletedDuplicateRows: 0,
      movedRows: 0,
      resolvedConflictRows: 1,
      deletedSourceDevice: true,
    });
    expect(deletedWhereArgs).toEqual([{ where: { id: { in: ["source-row"] } } }]);
    expect(deletedDevices).toEqual([{ where: { id: "source" } }]);
  });

  it("resolves conflicts by replacing lower target rows when the source total is higher", async () => {
    const deletedWhereArgs: unknown[] = [];
    const providerUpdateArgs: unknown[] = [];
    const modelUpdateArgs: unknown[] = [];
    const prisma = {
      device: {
        findMany: async () => [
          { id: "source", memberId: "member", name: "Mac", os: "darwin" },
          { id: "target", memberId: "member", name: "Mac", os: "darwin" },
        ],
        delete: async () => undefined,
      },
      dailyProviderUsage: {
        findMany: async ({ where }: { where: { deviceId: string } }) =>
          where.deviceId === "source"
            ? [{ id: "source-row", provider: "codex", date: new Date("2026-06-01T00:00:00.000Z"), totalTokens: 200n }]
            : [{ id: "target-row", provider: "codex", date: new Date("2026-06-01T00:00:00.000Z"), totalTokens: 150n }],
        deleteMany: async (args: unknown) => {
          deletedWhereArgs.push(args);
          return { count: 1 };
        },
        updateMany: async (args: unknown) => {
          providerUpdateArgs.push(args);
          return { count: 1 };
        },
      },
      dailyModelUsage: {
        updateMany: async (args: unknown) => {
          modelUpdateArgs.push(args);
          return { count: 1 };
        },
      },
    };

    await expect(
      mergeMemberDevices({
        prisma,
        memberId: "member",
        sourceDeviceId: "source",
        targetDeviceId: "target",
      }),
    ).resolves.toEqual({
      sourceDeviceId: "source",
      targetDeviceId: "target",
      deletedDuplicateRows: 0,
      movedRows: 1,
      resolvedConflictRows: 1,
      deletedSourceDevice: true,
    });
    expect(deletedWhereArgs).toEqual([{ where: { id: { in: ["target-row"] } } }]);
    expect(modelUpdateArgs).toEqual([
      {
        where: { dailyProviderUsageId: { in: ["source-row"] } },
        data: { deviceId: "target" },
      },
    ]);
    expect(providerUpdateArgs).toEqual([
      {
        where: { id: { in: ["source-row"] } },
        data: { deviceId: "target" },
      },
    ]);
  });
});
