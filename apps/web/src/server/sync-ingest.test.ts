import type { SyncPayload } from "@token-burn/shared";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { persistSyncPayload, type SyncIngestPrisma } from "./sync-ingest";

describe("persistSyncPayload", () => {
  it("creates daily provider cost/detail fields and model rows", async () => {
    const tx = createTransactionMock();
    const prisma = createPrismaMock(tx);
    const payload = createPayload({
      tokenCategories: { input: 100, output: 50 },
      tokenDetails: { reasoningOutput: 20 },
      totalTokens: 150,
      costUsd: 1.234567,
      costSource: "ccusage",
      costMetadata: { currency: "USD" },
      sourceSnapshot: { costUSD: 1.234567, totalTokens: 150 },
      models: [
        {
          modelName: "gpt-5.5",
          tokenCategories: { input: 100, output: 50 },
          tokenDetails: { reasoningOutput: 20 },
          totalTokens: 150,
          costUsd: 1.234567,
          metadata: { isFallback: false },
        },
      ],
    });

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-1",
      memberId: "member-1",
      payload,
    });

    const date = new Date(Date.UTC(2026, 4, 31));
    const syncedAt = new Date("2026-06-01T00:00:00.000Z");

    expect(tx.device.upsert).toHaveBeenCalledWith({
      where: {
        memberId_clientDeviceId: {
          memberId: "member-1",
          clientDeviceId: payload.deviceId,
        },
      },
      create: {
        memberId: "member-1",
        clientDeviceId: payload.deviceId,
        name: "nayan-vps",
        os: "linux",
        lastSeenAt: syncedAt,
      },
      update: {
        name: "nayan-vps",
        os: "linux",
        lastSeenAt: syncedAt,
      },
      select: { id: true },
    });

    expect(tx.dailyProviderUsage.updateMany).toHaveBeenCalledWith({
      where: {
        deviceId: "device-1",
        provider: "codex",
        date,
        totalTokens: { lte: 150n },
      },
      data: {
        memberId: "member-1",
        deviceId: "device-1",
        provider: "codex",
        date,
        tokenCategories: { input: 100, output: 50 },
        tokenDetails: { reasoningOutput: 20 },
        totalTokens: 150n,
        costUsd: "1.234567",
        costSource: "ccusage",
        costMetadata: { currency: "USD" },
        sourceSnapshot: { costUSD: 1.234567, totalTokens: 150 },
        cliVersion: "0.1.0",
        ccusageVersion: "16.2.5",
        os: "linux",
        syncedAt,
      },
    });
    expect(tx.dailyProviderUsage.findUnique).toHaveBeenCalledWith({
      where: {
        deviceId_provider_date: {
          deviceId: "device-1",
          provider: "codex",
          date,
        },
      },
      select: { id: true, totalTokens: true },
    });

    expect(tx.dailyProviderUsage.create).toHaveBeenCalledWith({
      data: {
        memberId: "member-1",
        deviceId: "device-1",
        provider: "codex",
        date,
        tokenCategories: { input: 100, output: 50 },
        tokenDetails: { reasoningOutput: 20 },
        totalTokens: 150n,
        costUsd: "1.234567",
        costSource: "ccusage",
        costMetadata: { currency: "USD" },
        sourceSnapshot: { costUSD: 1.234567, totalTokens: 150 },
        cliVersion: "0.1.0",
        ccusageVersion: "16.2.5",
        os: "linux",
        syncedAt,
      },
      select: { id: true },
    });

    expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalledWith({
      where: {
        deviceId: "device-1",
        provider: "codex",
        date,
      },
    });
    expect(tx.dailyModelUsage.createMany).toHaveBeenCalledWith({
      data: [
        {
          dailyProviderUsageId: "usage-1",
          memberId: "member-1",
          deviceId: "device-1",
          provider: "codex",
          date,
          modelName: "gpt-5.5",
          tokenCategories: { input: 100, output: 50 },
          tokenDetails: { reasoningOutput: 20 },
          totalTokens: 150n,
          costUsd: "1.234567",
          metadata: { isFallback: false },
        },
      ],
    });
    expect(tx.cliToken.update).toHaveBeenCalledWith({
      where: { id: "cli-token-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("clears stale model rows when a payload has no models", async () => {
    const tx = createTransactionMock();
    const prisma = createPrismaMock(tx);
    const payload = createPayload({
      tokenCategories: { input: 10 },
      totalTokens: 10,
      models: [],
    });

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-1",
      memberId: "member-1",
      payload,
    });

    expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalledWith({
      where: {
        deviceId: "device-1",
        provider: "codex",
        date: new Date(Date.UTC(2026, 4, 31)),
      },
    });
    expect(tx.dailyProviderUsage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenDetails: Prisma.DbNull,
          costUsd: null,
          costSource: null,
          costMetadata: Prisma.DbNull,
          sourceSnapshot: Prisma.DbNull,
        }),
      }),
    );
    expect(tx.dailyModelUsage.createMany).not.toHaveBeenCalled();
  });

  it("accepts an equal total and refreshes provider details", async () => {
    const tx = createTransactionMock();
    tx.dailyProviderUsage.updateMany.mockResolvedValue({ count: 1 });
    tx.dailyProviderUsage.findUnique.mockResolvedValue({
      id: "usage-1",
    });
    const prisma = createPrismaMock(tx);
    const payload = createPayload({
      tokenCategories: { input: 150 },
      totalTokens: 150,
      costUsd: 2,
      sourceSnapshot: { totalTokens: 150, costUSD: 2 },
    });

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-1",
      memberId: "member-1",
      payload,
    });

    expect(tx.dailyProviderUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          totalTokens: { lte: 150n },
        }),
        data: expect.objectContaining({
          totalTokens: 150n,
          costUsd: "2.000000",
          sourceSnapshot: { totalTokens: 150, costUSD: 2 },
        }),
      }),
    );
    expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalled();
  });

  it("accepts a higher total and replaces model rows", async () => {
    const tx = createTransactionMock();
    tx.dailyProviderUsage.updateMany.mockResolvedValue({ count: 1 });
    tx.dailyProviderUsage.findUnique.mockResolvedValue({
      id: "usage-1",
    });
    const prisma = createPrismaMock(tx);
    const payload = createPayload({
      tokenCategories: { input: 200 },
      totalTokens: 200,
      models: [
        {
          modelName: "gpt-5.5",
          tokenCategories: { input: 200 },
          totalTokens: 200,
        },
      ],
    });

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-1",
      memberId: "member-1",
      payload,
    });

    expect(tx.dailyProviderUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          totalTokens: { lte: 200n },
        }),
        data: expect.objectContaining({ totalTokens: 200n }),
      }),
    );
    expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalled();
    expect(tx.dailyModelUsage.createMany).toHaveBeenCalled();
  });

  it("preserves an existing higher daily provider snapshot", async () => {
    const tx = createTransactionMock();
    tx.dailyProviderUsage.updateMany.mockResolvedValue({ count: 0 });
    tx.dailyProviderUsage.findUnique.mockResolvedValue({
      id: "usage-1",
      totalTokens: 200n,
    });
    const prisma = createPrismaMock(tx);
    const payload = createPayload({
      tokenCategories: { input: 100 },
      totalTokens: 100,
      models: [
        {
          modelName: "gpt-5.5",
          tokenCategories: { input: 100 },
          totalTokens: 100,
        },
      ],
    });

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-1",
      memberId: "member-1",
      payload,
    });

    expect(tx.dailyProviderUsage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          totalTokens: { lte: 100n },
        }),
      }),
    );
    expect(tx.dailyProviderUsage.create).not.toHaveBeenCalled();
    expect(tx.dailyModelUsage.deleteMany).not.toHaveBeenCalled();
    expect(tx.dailyModelUsage.createMany).not.toHaveBeenCalled();
    expect(tx.cliToken.update).toHaveBeenCalledWith({
      where: { id: "cli-token-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("retries after a concurrent create conflict and refreshes model rows", async () => {
    const tx = createTransactionMock();
    tx.dailyProviderUsage.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    tx.dailyProviderUsage.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "usage-2" });
    tx.dailyProviderUsage.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    const prisma = createPrismaMock(tx);
    const payload = createPayload({
      tokenCategories: { input: 150 },
      totalTokens: 150,
      models: [
        {
          modelName: "gpt-5.5",
          tokenCategories: { input: 150 },
          totalTokens: 150,
        },
      ],
    });

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-1",
      memberId: "member-1",
      payload,
    });

    expect(tx.dailyProviderUsage.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.dailyProviderUsage.create).toHaveBeenCalledTimes(1);
    expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalled();
    expect(tx.dailyModelUsage.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            dailyProviderUsageId: "usage-2",
            totalTokens: 150n,
          }),
        ],
      }),
    );
  });
});

function createPayload(overrides: Partial<SyncPayload> = {}): SyncPayload {
  return {
    provider: "codex",
    date: "2026-05-31",
    tokenCategories: { input: 1 },
    totalTokens: 1,
    deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
    deviceName: "nayan-vps",
    cliVersion: "0.1.0",
    ccusageVersion: "16.2.5",
    os: "linux",
    syncedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function createTransactionMock() {
  return {
    device: {
      upsert: vi.fn().mockResolvedValue({ id: "device-1" }),
    },
    dailyProviderUsage: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "usage-1" }),
    },
    dailyModelUsage: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cliToken: {
      update: vi.fn().mockResolvedValue({ id: "cli-token-1" }),
    },
  };
}

function createPrismaMock(tx: ReturnType<typeof createTransactionMock>) {
  return {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as SyncIngestPrisma;
}
