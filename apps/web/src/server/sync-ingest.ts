import type { SyncPayload } from "@token-burn/shared";
import { Prisma } from "@prisma/client";

import { prisma as prismaClient } from "@/lib/prisma";

type SyncIngestTransaction = {
  device: {
    upsert(args: Prisma.DeviceUpsertArgs): Promise<{ id: string }>;
  };
  dailyProviderUsage: {
    upsert(args: Prisma.DailyProviderUsageUpsertArgs): Promise<{ id: string }>;
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

    const usage = await tx.dailyProviderUsage.upsert({
      where: {
        deviceId_provider_date: {
          deviceId: device.id,
          provider: payload.provider,
          date,
        },
      },
      create: {
        memberId,
        deviceId: device.id,
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
      },
      update: {
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
      },
      select: { id: true },
    });

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
