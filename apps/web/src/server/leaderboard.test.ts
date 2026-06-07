import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  dailyModelUsage: {
    groupBy: vi.fn(),
  },
  dailyProviderUsage: {
    aggregate: vi.fn(),
    groupBy: vi.fn(),
  },
  device: {
    findMany: vi.fn(),
  },
  member: {
    findUnique: vi.fn(),
  },
}));

vi.mock("../lib/prisma", () => ({
  prisma: prismaMock,
}));

import {
  bigIntToSafeNumber,
  getMemberUsageDetail,
  rankRows,
} from "./leaderboard";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rankRows", () => {
  it("sorts by total tokens descending and assigns ranks", () => {
    expect(
      rankRows([
        {
          username: "ada",
          displayName: "Ada",
          totalTokens: 100n,
          totalCostUsd: 1.25,
        },
        {
          username: "linus",
          displayName: "Linus",
          totalTokens: 300n,
          totalCostUsd: 12.5,
        },
        {
          username: "grace",
          displayName: "Grace",
          totalTokens: 200n,
          totalCostUsd: 3,
        },
      ]),
    ).toEqual([
      {
        rank: 1,
        username: "linus",
        displayName: "Linus",
        totalTokens: 300,
        totalCostUsd: 12.5,
      },
      {
        rank: 2,
        username: "grace",
        displayName: "Grace",
        totalTokens: 200,
        totalCostUsd: 3,
      },
      {
        rank: 3,
        username: "ada",
        displayName: "Ada",
        totalTokens: 100,
        totalCostUsd: 1.25,
      },
    ]);
  });

  it("sorts tied totals by display name ascending", () => {
    expect(
      rankRows([
        {
          username: "linus",
          displayName: "Linus",
          totalTokens: 200n,
          totalCostUsd: 2,
        },
        {
          username: "ada",
          displayName: "Ada",
          totalTokens: 200n,
          totalCostUsd: 1,
        },
        {
          username: "grace",
          displayName: "Grace",
          totalTokens: 300n,
          totalCostUsd: 3,
        },
      ]),
    ).toEqual([
      {
        rank: 1,
        username: "grace",
        displayName: "Grace",
        totalTokens: 300,
        totalCostUsd: 3,
      },
      {
        rank: 2,
        username: "ada",
        displayName: "Ada",
        totalTokens: 200,
        totalCostUsd: 1,
      },
      {
        rank: 3,
        username: "linus",
        displayName: "Linus",
        totalTokens: 200,
        totalCostUsd: 2,
      },
    ]);
  });
});

describe("bigIntToSafeNumber", () => {
  it("converts safe bigint totals to numbers", () => {
    expect(bigIntToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("throws when totals exceed JavaScript safe integer precision", () => {
    expect(() =>
      bigIntToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    ).toThrow("Token total exceeds JavaScript safe integer precision");
  });
});

describe("getMemberUsageDetail", () => {
  it("aggregates weekly trend, provider, model, and device usage for a known member", async () => {
    prismaMock.member.findUnique.mockResolvedValue({
      id: "member-1",
      username: "ada",
      displayName: "Ada",
    });
    prismaMock.dailyProviderUsage.aggregate.mockResolvedValue({
      _sum: { totalTokens: 300n, costUsd: 3.75 },
    });
    prismaMock.dailyProviderUsage.groupBy
      .mockResolvedValueOnce([
        {
          date: new Date("2026-06-01T00:00:00.000Z"),
          _sum: { totalTokens: 100n, costUsd: 1.25 },
        },
        {
          date: new Date("2026-06-02T00:00:00.000Z"),
          _sum: { totalTokens: 200n, costUsd: 2.5 },
        },
      ])
      .mockResolvedValueOnce([
        { provider: "codex", _sum: { totalTokens: 300n, costUsd: 3.75 } },
      ])
      .mockResolvedValueOnce([
        { deviceId: "device-1", _sum: { totalTokens: 300n, costUsd: 3.75 } },
      ]);
    prismaMock.dailyModelUsage.groupBy.mockResolvedValue([
      {
        provider: "codex",
        modelName: "gpt-5-codex",
        _sum: { totalTokens: 250n, costUsd: 3 },
      },
    ]);
    prismaMock.device.findMany.mockResolvedValue([
      { id: "device-1", name: "Ada MacBook", os: "darwin" },
    ]);

    await expect(
      getMemberUsageDetail(
        "ada",
        "weekly",
        new Date("2026-06-07T12:00:00.000Z"),
      ),
    ).resolves.toEqual({
      member: {
        username: "ada",
        displayName: "Ada",
      },
      period: "weekly",
      summary: {
        rank: null,
        totalTokens: 300,
        totalCostUsd: 3.75,
      },
      trend: [
        { date: "2026-06-01", totalTokens: 100, totalCostUsd: 1.25 },
        { date: "2026-06-02", totalTokens: 200, totalCostUsd: 2.5 },
      ],
      providers: [{ provider: "codex", totalTokens: 300, totalCostUsd: 3.75 }],
      models: [
        {
          provider: "codex",
          modelName: "gpt-5-codex",
          totalTokens: 250,
          totalCostUsd: 3,
        },
      ],
      devices: [
        {
          deviceName: "Ada MacBook",
          os: "darwin",
          totalTokens: 300,
          totalCostUsd: 3.75,
        },
      ],
    });

    const weeklyDateFilter = {
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lt: new Date("2026-06-08T00:00:00.000Z"),
    };
    expect(prismaMock.dailyProviderUsage.aggregate).toHaveBeenCalledWith({
      _sum: { totalTokens: true, costUsd: true },
      where: { memberId: "member-1", date: weeklyDateFilter },
    });
    expect(prismaMock.dailyProviderUsage.groupBy).toHaveBeenNthCalledWith(1, {
      by: ["date"],
      _sum: { totalTokens: true, costUsd: true },
      where: { memberId: "member-1", date: weeklyDateFilter },
      orderBy: { date: "asc" },
    });
    expect(prismaMock.dailyModelUsage.groupBy).toHaveBeenCalledWith({
      by: ["provider", "modelName"],
      _sum: { totalTokens: true, costUsd: true },
      where: { memberId: "member-1", date: weeklyDateFilter },
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 5,
    });
  });

  it("uses all-time summary breakdowns and a zero-filled recent 30-day trend", async () => {
    prismaMock.member.findUnique.mockResolvedValue({
      id: "member-1",
      username: "ada",
      displayName: "Ada",
    });
    prismaMock.dailyProviderUsage.aggregate.mockResolvedValue({
      _sum: { totalTokens: 500n, costUsd: 5 },
    });
    prismaMock.dailyProviderUsage.groupBy
      .mockResolvedValueOnce([
        {
          date: new Date("2026-06-07T00:00:00.000Z"),
          _sum: { totalTokens: 50n, costUsd: 0.5 },
        },
      ])
      .mockResolvedValueOnce([
        { provider: "codex", _sum: { totalTokens: 500n, costUsd: 5 } },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.dailyModelUsage.groupBy.mockResolvedValue([]);
    prismaMock.device.findMany.mockResolvedValue([]);

    const detail = await getMemberUsageDetail(
      "ada",
      "all-time",
      new Date("2026-06-07T12:00:00.000Z"),
    );

    expect(detail?.summary).toEqual({
      rank: null,
      totalTokens: 500,
      totalCostUsd: 5,
    });
    expect(detail?.providers).toEqual([
      { provider: "codex", totalTokens: 500, totalCostUsd: 5 },
    ]);
    expect(detail?.trend).toHaveLength(30);
    expect(detail?.trend[0]).toEqual({
      date: "2026-05-09",
      totalTokens: 0,
      totalCostUsd: 0,
    });
    expect(detail?.trend.at(-1)).toEqual({
      date: "2026-06-07",
      totalTokens: 50,
      totalCostUsd: 0.5,
    });
    expect(prismaMock.dailyProviderUsage.aggregate).toHaveBeenCalledWith({
      _sum: { totalTokens: true, costUsd: true },
      where: { memberId: "member-1" },
    });
    expect(prismaMock.dailyProviderUsage.groupBy).toHaveBeenNthCalledWith(1, {
      by: ["date"],
      _sum: { totalTokens: true, costUsd: true },
      where: {
        memberId: "member-1",
        date: {
          gte: new Date("2026-05-09T00:00:00.000Z"),
          lt: new Date("2026-06-08T00:00:00.000Z"),
        },
      },
      orderBy: { date: "asc" },
    });
  });

  it("uses a zero-filled trailing 7-day range for member usage detail", async () => {
    prismaMock.member.findUnique.mockResolvedValue({
      id: "member-1",
      username: "ada",
      displayName: "Ada",
    });
    prismaMock.dailyProviderUsage.aggregate.mockResolvedValue({
      _sum: { totalTokens: 70n, costUsd: 0.7 },
    });
    prismaMock.dailyProviderUsage.groupBy
      .mockResolvedValueOnce([
        {
          date: new Date("2026-06-07T00:00:00.000Z"),
          _sum: { totalTokens: 70n, costUsd: 0.7 },
        },
      ])
      .mockResolvedValueOnce([
        { provider: "codex", _sum: { totalTokens: 70n, costUsd: 0.7 } },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.dailyModelUsage.groupBy.mockResolvedValue([]);
    prismaMock.device.findMany.mockResolvedValue([]);

    const detail = await getMemberUsageDetail(
      "ada",
      "7d",
      new Date("2026-06-07T12:00:00.000Z"),
    );

    expect(detail?.period).toBe("7d");
    expect(detail?.summary).toEqual({
      rank: null,
      totalTokens: 70,
      totalCostUsd: 0.7,
    });
    expect(detail?.trend).toHaveLength(7);
    expect(detail?.trend[0]).toEqual({
      date: "2026-06-01",
      totalTokens: 0,
      totalCostUsd: 0,
    });
    expect(detail?.trend.at(-1)).toEqual({
      date: "2026-06-07",
      totalTokens: 70,
      totalCostUsd: 0.7,
    });
    expect(prismaMock.dailyProviderUsage.aggregate).toHaveBeenCalledWith({
      _sum: { totalTokens: true, costUsd: true },
      where: {
        memberId: "member-1",
        date: {
          gte: new Date("2026-06-01T00:00:00.000Z"),
          lt: new Date("2026-06-08T00:00:00.000Z"),
        },
      },
    });
    expect(prismaMock.dailyModelUsage.groupBy).toHaveBeenCalledWith({
      by: ["provider", "modelName"],
      _sum: { totalTokens: true, costUsd: true },
      where: {
        memberId: "member-1",
        date: {
          gte: new Date("2026-06-01T00:00:00.000Z"),
          lt: new Date("2026-06-08T00:00:00.000Z"),
        },
      },
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 5,
    });
  });

  it("returns null for an unknown member", async () => {
    prismaMock.member.findUnique.mockResolvedValue(null);

    await expect(
      getMemberUsageDetail(
        "unknown",
        "weekly",
        new Date("2026-06-07T12:00:00.000Z"),
      ),
    ).resolves.toBeNull();

    expect(prismaMock.dailyProviderUsage.aggregate).not.toHaveBeenCalled();
    expect(prismaMock.dailyProviderUsage.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.dailyModelUsage.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.device.findMany).not.toHaveBeenCalled();
  });
});
