import type { SyncPayload } from "@token-burn/shared";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { persistSyncPayload, type SyncIngestPrisma } from "./sync-ingest";

describe("persistSyncPayload", () => {
  it("upserts daily provider cost/detail fields and replaces model rows", async () => {
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

    expect(tx.dailyProviderUsage.upsert).toHaveBeenCalledWith({
      where: {
        deviceId_provider_date: {
          deviceId: "device-1",
          provider: "codex",
          date,
        },
      },
      create: {
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
      update: {
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
    expect(tx.dailyProviderUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tokenDetails: Prisma.DbNull,
          costUsd: null,
          costSource: null,
          costMetadata: Prisma.DbNull,
          sourceSnapshot: Prisma.DbNull,
        }),
        update: expect.objectContaining({
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
      upsert: vi.fn().mockResolvedValue({ id: "usage-1" }),
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
