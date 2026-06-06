import { providers, type Provider, type SyncWindowsResponse } from "@token-burn/shared";
import type { Prisma } from "@prisma/client";

import { prisma as prismaClient } from "@/lib/prisma";

type ProviderWindowRow = {
  provider: string;
  _max: {
    syncedAt: Date | null;
  };
};

export type SyncWindowsPrisma = {
  dailyProviderUsage: {
    groupBy(args: Prisma.DailyProviderUsageGroupByArgs): Promise<ProviderWindowRow[]>;
  };
};

export async function buildSyncWindows({
  prisma = prismaClient as unknown as SyncWindowsPrisma,
  memberId,
  clientDeviceId,
  now = () => new Date(),
}: {
  prisma?: SyncWindowsPrisma;
  memberId: string;
  clientDeviceId: string;
  now?: () => Date;
}): Promise<SyncWindowsResponse> {
  const serverNow = now();
  const rows = await prisma.dailyProviderUsage.groupBy({
    by: ["provider"],
    where: {
      memberId,
      device: {
        clientDeviceId,
      },
    },
    _max: {
      syncedAt: true,
    },
  });

  const latestSyncedAtByProvider = new Map(
    rows.flatMap((row) => {
      if (!isProvider(row.provider) || !row._max.syncedAt) return [];
      return [[row.provider, row._max.syncedAt] as const];
    }),
  );

  return {
    serverTime: serverNow.toISOString(),
    until: toUtcDate(serverNow),
    providers: providers.map((provider) => {
      const syncedAt = latestSyncedAtByProvider.get(provider);
      return syncedAt ? { provider, since: toUtcDate(syncedAt) } : { provider };
    }),
  };
}

function isProvider(value: string): value is Provider {
  return (providers as readonly string[]).includes(value);
}

function toUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
