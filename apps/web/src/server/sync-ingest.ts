import type { SyncPayload } from "@token-burn/shared";
import { Prisma } from "@prisma/client";

import { prisma as prismaClient } from "@/lib/prisma";

type SyncIngestTransaction = {
  device: {
    upsert(args: Prisma.DeviceUpsertArgs): Promise<{ id: string }>;
  };
  dailyProviderUsage: {
    updateMany(args: Prisma.DailyProviderUsageUpdateManyArgs): Promise<Prisma.BatchPayload>;
    findUnique(
      args: Prisma.DailyProviderUsageFindUniqueArgs,
    ): Promise<{ id: string; totalTokens?: bigint } | null>;
    create(args: Prisma.DailyProviderUsageCreateArgs): Promise<{ id: string }>;
  };
  dailyModelUsage: {
    deleteMany(args: Prisma.DailyModelUsageDeleteManyArgs): Promise<unknown>;
    createMany(args: Prisma.DailyModelUsageCreateManyArgs): Promise<unknown>;
  };
  cliToken: {
    update(args: Prisma.CliTokenUpdateArgs): Promise<unknown>;
  };
};

export type SyncIngestPrisma = {
  $transaction<T>(callback: (tx: SyncIngestTransaction) => Promise<T>): Promise<T>;
};

type PersistSyncPayloadOptions = {
  prisma?: SyncIngestPrisma;
  cliTokenId: string;
  memberId: string;
  payload: SyncPayload;
};

type NullableJsonInput = Prisma.InputJsonValue | typeof Prisma.DbNull;

export async function persistSyncPayload({
  prisma = prismaClient as unknown as SyncIngestPrisma,
  cliTokenId,
  memberId,
  payload,
}: PersistSyncPayloadOptions) {
  const date = parseUtcDate(payload.date);
  const syncedAt = new Date(payload.syncedAt);

  await prisma.$transaction(async (tx) => {
    const device = await tx.device.upsert({
      where: {
        memberId_clientDeviceId: {
          memberId,
          clientDeviceId: payload.deviceId,
        },
      },
      create: {
        memberId,
        clientDeviceId: payload.deviceId,
        name: payload.deviceName,
        os: payload.os,
        lastSeenAt: syncedAt,
      },
      update: {
        name: payload.deviceName,
        os: payload.os,
        lastSeenAt: syncedAt,
      },
      select: { id: true },
    });

    const usageKey = {
      deviceId_provider_date: {
        deviceId: device.id,
        provider: payload.provider,
        date,
      },
    };
    const incomingTotalTokens = BigInt(payload.totalTokens);
    const usageData = providerUsageData({ memberId, deviceId: device.id, payload, date, syncedAt });
    const usage = await persistProviderUsage({
      tx,
      usageKey,
      usageData,
      incomingTotalTokens,
    });

    if (usage) {
      await tx.dailyModelUsage.deleteMany({
        where: {
          deviceId: device.id,
          provider: payload.provider,
          date,
        },
      });

      if (payload.models?.length) {
        await tx.dailyModelUsage.createMany({
          data: payload.models.map((model) => ({
            dailyProviderUsageId: usage.id,
            memberId,
            deviceId: device.id,
            provider: payload.provider,
            date,
            modelName: model.modelName,
            tokenCategories: model.tokenCategories,
            tokenDetails: nullableJson(model.tokenDetails),
            totalTokens: BigInt(model.totalTokens),
            costUsd: decimalInput(model.costUsd),
            metadata: nullableJson(model.metadata),
          })),
        });
      }
    }

    await tx.cliToken.update({
      where: { id: cliTokenId },
      data: { lastUsedAt: new Date() },
    });
  });
}

export function parseUtcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Invalid date");
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Invalid date");
  }

  return date;
}

function decimalInput(value: number | undefined): string | null {
  return value === undefined ? null : value.toFixed(6);
}

function nullableJson(value: Record<string, unknown> | undefined): NullableJsonInput {
  return value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

function providerUsageData({
  memberId,
  deviceId,
  payload,
  date,
  syncedAt,
}: {
  memberId: string;
  deviceId: string;
  payload: SyncPayload;
  date: Date;
  syncedAt: Date;
}) {
  return {
    memberId,
    deviceId,
    provider: payload.provider,
    date,
    tokenCategories: payload.tokenCategories,
    tokenDetails: nullableJson(payload.tokenDetails),
    totalTokens: BigInt(payload.totalTokens),
    costUsd: decimalInput(payload.costUsd),
    costSource: payload.costSource ?? null,
    costMetadata: nullableJson(payload.costMetadata),
    sourceSnapshot: nullableJson(payload.sourceSnapshot),
    cliVersion: payload.cliVersion,
    ccusageVersion: payload.ccusageVersion,
    os: payload.os,
    syncedAt,
  };
}

async function persistProviderUsage({
  tx,
  usageKey,
  usageData,
  incomingTotalTokens,
}: {
  tx: SyncIngestTransaction;
  usageKey: {
    deviceId_provider_date: {
      deviceId: string;
      provider: string;
      date: Date;
    };
  };
  usageData: ReturnType<typeof providerUsageData>;
  incomingTotalTokens: bigint;
}): Promise<{ id: string } | null> {
  const updated = await tx.dailyProviderUsage.updateMany({
    where: providerUsageUpdateWhere(usageKey, incomingTotalTokens),
    data: usageData,
  });

  if (updated.count > 0) {
    return await requireProviderUsageId(tx, usageKey);
  }

  const existingUsage = await tx.dailyProviderUsage.findUnique({
    where: usageKey,
    select: { id: true, totalTokens: true },
  });

  if (existingUsage) {
    return null;
  }

  try {
    return await tx.dailyProviderUsage.create({
      data: usageData,
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  const retriedUpdate = await tx.dailyProviderUsage.updateMany({
    where: providerUsageUpdateWhere(usageKey, incomingTotalTokens),
    data: usageData,
  });

  if (retriedUpdate.count > 0) {
    return await requireProviderUsageId(tx, usageKey);
  }

  const concurrentUsage = await tx.dailyProviderUsage.findUnique({
    where: usageKey,
    select: { id: true, totalTokens: true },
  });

  if (concurrentUsage) {
    return null;
  }

  throw new Error("Daily provider usage row disappeared during ingest");
}

function providerUsageUpdateWhere(
  usageKey: {
    deviceId_provider_date: {
      deviceId: string;
      provider: string;
      date: Date;
    };
  },
  incomingTotalTokens: bigint,
): Prisma.DailyProviderUsageWhereInput {
  const { deviceId, provider, date } = usageKey.deviceId_provider_date;

  return {
    deviceId,
    provider,
    date,
    totalTokens: { lte: incomingTotalTokens },
  };
}

async function requireProviderUsageId(
  tx: SyncIngestTransaction,
  usageKey: {
    deviceId_provider_date: {
      deviceId: string;
      provider: string;
      date: Date;
    };
  },
): Promise<{ id: string }> {
  const usage = await tx.dailyProviderUsage.findUnique({
    where: usageKey,
    select: { id: true },
  });

  if (!usage) {
    throw new Error("Missing daily provider usage after accepted snapshot update");
  }

  return usage;
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
