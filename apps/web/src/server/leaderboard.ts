import {
  providerSchema,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type MemberUsageRange,
  type MemberUsageDetail,
} from "@token-burn/shared";

import { prisma } from "../lib/prisma";
import { getPeriodRange, getRecentUtcDateWindow } from "../lib/time";

export type RawRow = {
  username: string;
  displayName: string;
  totalTokens: bigint;
  totalCostUsd: number;
};

export function bigIntToSafeNumber(total: bigint): number {
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Token total exceeds JavaScript safe integer precision");
  }

  return Number(total);
}

export function rankRows(rows: RawRow[]): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => {
      if (a.totalTokens === b.totalTokens)
        return a.displayName.localeCompare(b.displayName);
      return a.totalTokens > b.totalTokens ? -1 : 1;
    })
    .map((row, index) => ({
      rank: index + 1,
      username: row.username,
      displayName: row.displayName,
      totalTokens: bigIntToSafeNumber(row.totalTokens),
      totalCostUsd: row.totalCostUsd,
    }));
}

export async function getLeaderboard(
  period: LeaderboardPeriod,
): Promise<LeaderboardRow[]> {
  const range = getPeriodRange(period);
  const dateFilter =
    range.start && range.end
      ? {
          gte: range.start,
          lt: range.end,
        }
      : undefined;

  const totals = await prisma.dailyProviderUsage.groupBy({
    by: ["memberId"],
    _sum: {
      totalTokens: true,
      costUsd: true,
    },
    where: dateFilter ? { date: dateFilter } : undefined,
  });

  const positiveTotals = totals.filter(
    (total) => (total._sum.totalTokens ?? 0n) > 0n,
  );
  if (positiveTotals.length === 0) return [];

  const members = await prisma.member.findMany({
    where: {
      id: {
        in: positiveTotals.map((total) => total.memberId),
      },
    },
    select: {
      id: true,
      username: true,
      displayName: true,
    },
  });
  const membersByMemberId = new Map(
    members.map((member) => [member.id, member]),
  );

  return rankRows(
    positiveTotals.flatMap((total) => {
      const member = membersByMemberId.get(total.memberId);
      const totalTokens = total._sum.totalTokens;
      const totalCostUsd =
        total._sum.costUsd === null ? 0 : Number(total._sum.costUsd);

      if (!member || totalTokens === null) return [];

      return [
        {
          username: member.username,
          displayName: member.displayName,
          totalTokens,
          totalCostUsd,
        },
      ];
    }),
  );
}

type DateFilter = {
  gte: Date;
  lt: Date;
};

type SumRow = {
  _sum: {
    totalTokens: bigint | null;
    costUsd: unknown;
  };
};

type UsageTotals = {
  totalTokens: number;
  totalCostUsd: number;
};

const publicOperatingSystems = ["darwin", "linux", "win32"] as const;
type PublicOperatingSystem = (typeof publicOperatingSystems)[number];
export type MemberUsageRequestPeriod = LeaderboardPeriod | MemberUsageRange;

export type MemberUsageModelFilter = {
  provider: MemberUsageDetail["models"][number]["provider"];
  modelName: string;
};

export type MemberUsageFilters = {
  providers: MemberUsageDetail["providers"][number]["provider"][];
  models: MemberUsageModelFilter[];
  devices: string[];
};

const emptyMemberUsageFilters: MemberUsageFilters = {
  providers: [],
  models: [],
  devices: [],
};

export async function getMemberUsageDetail(
  username: string,
  period: MemberUsageRequestPeriod,
  now = new Date(),
  filters: MemberUsageFilters = emptyMemberUsageFilters,
): Promise<MemberUsageDetail | null> {
  const member = await prisma.member.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
    },
  });

  if (!member) return null;

  let summaryDateFilter: DateFilter | undefined;
  let trendDates: string[] | null = null;

  if (isMemberUsageRange(period)) {
    trendDates = getRecentUtcDateWindow(getMemberUsageRangeDays(period), now);
    summaryDateFilter = dateWindowFilter(
      trendDates[0] as string,
      trendDates[trendDates.length - 1] as string,
    );
  } else {
    summaryDateFilter = getPeriodDateFilter(period, now);
    trendDates = period === "all-time" ? getRecentUtcDateWindow(30, now) : null;
  }

  const hasModelFilters = filters.models.length > 0;
  const summaryWhere = hasModelFilters
    ? usageWhere(member.id, summaryDateFilter, {
        models: filters.models,
        devices: filters.devices,
      })
    : usageWhere(member.id, summaryDateFilter, {
        providers: filters.providers,
        devices: filters.devices,
      });
  const trendDateFilter = trendDates
    ? dateWindowFilter(
        trendDates[0] as string,
        trendDates[trendDates.length - 1] as string,
      )
    : summaryDateFilter;
  const trendWhere = hasModelFilters
    ? usageWhere(member.id, trendDateFilter, {
        models: filters.models,
        devices: filters.devices,
      })
    : usageWhere(member.id, trendDateFilter, {
        providers: filters.providers,
        devices: filters.devices,
      });
  const providerBreakdownWhere = hasModelFilters
    ? usageWhere(member.id, summaryDateFilter, {
        models: filters.models,
        devices: filters.devices,
      })
    : usageWhere(member.id, summaryDateFilter, {
        devices: filters.devices,
      });
  const modelBreakdownWhere = usageWhere(member.id, summaryDateFilter, {
    providers: filters.providers,
    devices: filters.devices,
  });
  const deviceBreakdownWhere = hasModelFilters
    ? usageWhere(member.id, summaryDateFilter, {
        models: filters.models,
      })
    : usageWhere(member.id, summaryDateFilter, {
        providers: filters.providers,
      });

  const [
    summary,
    trendRows,
    providerRows,
    modelRows,
    providerCostRows,
    providerTrendCostRows,
    providerDeviceCostRows,
    deviceRows,
  ] = await Promise.all([
    hasModelFilters
      ? prisma.dailyModelUsage.groupBy({
          by: ["provider", "modelName"],
          _sum: { totalTokens: true, costUsd: true },
          where: summaryWhere,
        })
      : prisma.dailyProviderUsage.aggregate({
          _sum: { totalTokens: true, costUsd: true },
          where: summaryWhere,
        }),
    hasModelFilters
      ? prisma.dailyModelUsage.groupBy({
          by: ["date", "provider", "modelName"],
          _sum: { totalTokens: true, costUsd: true },
          where: trendWhere,
          orderBy: { date: "asc" },
        })
      : prisma.dailyProviderUsage.groupBy({
          by: ["date"],
          _sum: { totalTokens: true, costUsd: true },
          where: trendWhere,
          orderBy: { date: "asc" },
        }),
    hasModelFilters
      ? prisma.dailyModelUsage.groupBy({
          by: ["provider"],
          _sum: { totalTokens: true, costUsd: true },
          where: providerBreakdownWhere,
          orderBy: { _sum: { totalTokens: "desc" } },
        })
      : prisma.dailyProviderUsage.groupBy({
          by: ["provider"],
          _sum: { totalTokens: true, costUsd: true },
          where: providerBreakdownWhere,
          orderBy: { _sum: { totalTokens: "desc" } },
        }),
    prisma.dailyModelUsage.groupBy({
      by: ["provider", "modelName"],
      _sum: { totalTokens: true, costUsd: true },
      where: modelBreakdownWhere,
      orderBy: { _sum: { totalTokens: "desc" } },
      take: 5,
    }),
    hasModelFilters
      ? prisma.dailyProviderUsage.groupBy({
          by: ["provider"],
          _sum: { totalTokens: true, costUsd: true },
          where: modelBreakdownWhere,
          orderBy: { _sum: { totalTokens: "desc" } },
        })
      : Promise.resolve(null),
    hasModelFilters
      ? prisma.dailyProviderUsage.groupBy({
          by: ["date", "provider"],
          _sum: { totalTokens: true, costUsd: true },
          where: usageWhere(member.id, trendDateFilter, {
            providers: uniqueProvidersForModels(filters.models),
            devices: filters.devices,
          }),
          orderBy: { date: "asc" },
        })
      : Promise.resolve(null),
    hasModelFilters
      ? prisma.dailyProviderUsage.groupBy({
          by: ["deviceId", "provider"],
          _sum: { totalTokens: true, costUsd: true },
          where: usageWhere(member.id, summaryDateFilter, {
            providers: uniqueProvidersForModels(filters.models),
          }),
          orderBy: { _sum: { totalTokens: "desc" } },
        })
      : Promise.resolve(null),
    hasModelFilters
      ? prisma.dailyModelUsage.groupBy({
          by: ["deviceId", "provider", "modelName"],
          _sum: { totalTokens: true, costUsd: true },
          where: deviceBreakdownWhere,
          orderBy: { _sum: { totalTokens: "desc" } },
        })
      : prisma.dailyProviderUsage.groupBy({
          by: ["deviceId"],
          _sum: { totalTokens: true, costUsd: true },
          where: deviceBreakdownWhere,
          orderBy: { _sum: { totalTokens: "desc" } },
          take: 5,
        }),
  ]);

  const providerTotalsByProvider = new Map(
    (providerCostRows ?? providerRows).map((row) => [
      row.provider,
      sumToTotals(row),
    ]),
  );
  const providerTrendTotalsByDateProvider = new Map(
    (providerTrendCostRows ?? []).map((row) => [
      dateProviderKey(row.date, row.provider),
      sumToTotals(row),
    ]),
  );
  const providerDeviceTotalsByDeviceProvider = new Map(
    (providerDeviceCostRows ?? []).map((row) => [
      deviceProviderKey(row.deviceId, row.provider),
      sumToTotals(row),
    ]),
  );
  const deviceTotals = hasModelFilters
    ? modelDeviceRowsToTotals(
        deviceRows as Array<SumRow & { deviceId: string; provider: string }>,
        providerDeviceTotalsByDeviceProvider,
      )
    : (deviceRows as Array<SumRow & { deviceId: string }>).map((row) => ({
        deviceId: row.deviceId,
        ...sumToTotals(row),
      }));

  const devices = await prisma.device.findMany({
    where: {
      id: {
        in: deviceTotals.map((row) => row.deviceId),
      },
    },
    select: {
      id: true,
      name: true,
      os: true,
    },
  });
  const devicesById = new Map(devices.map((device) => [device.id, device]));
  const summaryTotals = hasModelFilters
    ? modelRowsToTotals(
        summary as Array<SumRow & { provider: string }>,
        providerTotalsByProvider,
      )
    : sumToTotals(summary as SumRow);
  const trend = hasModelFilters
    ? modelTrendRowsToTrend(
        trendRows as Array<SumRow & { date: Date; provider: string }>,
        providerTrendTotalsByDateProvider,
        trendDates,
      )
    : trendDates
      ? zeroFillTrend(trendDates, trendRows as Array<SumRow & { date: Date }>)
      : (trendRows as Array<SumRow & { date: Date }>).map((row) => ({
          date: toIsoDate(row.date),
          ...sumToTotals(row),
        }));

  return {
    member: {
      username: member.username,
      displayName: member.displayName,
    },
    period,
    summary: {
      rank: null,
      ...summaryTotals,
    },
    trend,
    providers: providerRows.flatMap((row) => {
      const provider = parseProvider(row.provider);
      if (!provider) return [];

      return [
        {
          provider,
          ...(hasModelFilters ? modelToTotals(row, providerTotalsByProvider) : sumToTotals(row)),
        },
      ];
    }),
    models: modelRows.flatMap((row) => {
      const provider = parseProvider(row.provider);
      if (!provider) return [];

      return [
        {
          provider,
          modelName: row.modelName,
          ...modelToTotals(row, providerTotalsByProvider),
        },
      ];
    }),
    devices: deviceTotals.flatMap((row) => {
      const device = devicesById.get(row.deviceId);
      const os = parseOperatingSystem(device?.os);
      if (!device || !os) return [];

      return [{ deviceName: device.name, os, ...row }];
    }),
  };
}

function modelToTotals(
  row: SumRow & { provider: string },
  providerTotalsByProvider: Map<string, { totalTokens: number; totalCostUsd: number }>,
): {
  totalTokens: number;
  totalCostUsd: number;
} {
  const totals = sumToTotals(row);
  if (row._sum.costUsd != null) return totals;

  const providerTotals = providerTotalsByProvider.get(row.provider);
  if (!providerTotals || providerTotals.totalTokens === 0 || totals.totalTokens === 0) {
    return totals;
  }

  return {
    totalTokens: totals.totalTokens,
    totalCostUsd: providerTotals.totalCostUsd * (totals.totalTokens / providerTotals.totalTokens),
  };
}

function modelRowsToTotals(
  rows: Array<SumRow & { provider: string }>,
  providerTotalsByProvider: Map<string, UsageTotals>,
): UsageTotals {
  return rows.reduce<UsageTotals>(
    (total, row) => {
      const rowTotals = modelToTotals(row, providerTotalsByProvider);

      return {
        totalTokens: total.totalTokens + rowTotals.totalTokens,
        totalCostUsd: total.totalCostUsd + rowTotals.totalCostUsd,
      };
    },
    { totalTokens: 0, totalCostUsd: 0 },
  );
}

function modelTrendRowsToTrend(
  rows: Array<SumRow & { date: Date; provider: string }>,
  providerTotalsByDateProvider: Map<string, UsageTotals>,
  dates: string[] | null,
): MemberUsageDetail["trend"] {
  const totalsByDate = new Map<string, UsageTotals>();

  for (const row of rows) {
    const date = toIsoDate(row.date);
    const rowTotals = modelToTotalsForProvider(
      row,
      providerTotalsByDateProvider.get(dateProviderKey(row.date, row.provider)),
    );
    const current = totalsByDate.get(date) ?? { totalTokens: 0, totalCostUsd: 0 };
    totalsByDate.set(date, {
      totalTokens: current.totalTokens + rowTotals.totalTokens,
      totalCostUsd: current.totalCostUsd + rowTotals.totalCostUsd,
    });
  }

  if (dates) {
    return dates.map((date) => ({
      date,
      ...(totalsByDate.get(date) ?? { totalTokens: 0, totalCostUsd: 0 }),
    }));
  }

  return [...totalsByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, totals]) => ({ date, ...totals }));
}

function modelDeviceRowsToTotals(
  rows: Array<SumRow & { deviceId: string; provider: string }>,
  providerTotalsByDeviceProvider: Map<string, UsageTotals>,
): Array<{ deviceId: string } & UsageTotals> {
  const totalsByDevice = new Map<string, UsageTotals>();

  for (const row of rows) {
    const rowTotals = modelToTotalsForProvider(
      row,
      providerTotalsByDeviceProvider.get(deviceProviderKey(row.deviceId, row.provider)),
    );
    const current = totalsByDevice.get(row.deviceId) ?? { totalTokens: 0, totalCostUsd: 0 };
    totalsByDevice.set(row.deviceId, {
      totalTokens: current.totalTokens + rowTotals.totalTokens,
      totalCostUsd: current.totalCostUsd + rowTotals.totalCostUsd,
    });
  }

  return [...totalsByDevice.entries()]
    .map(([deviceId, totals]) => ({ deviceId, ...totals }))
    .sort((left, right) => right.totalTokens - left.totalTokens)
    .slice(0, 5);
}

function modelToTotalsForProvider(
  row: SumRow,
  providerTotals: UsageTotals | undefined,
): UsageTotals {
  const totals = sumToTotals(row);
  if (row._sum.costUsd != null) return totals;

  if (!providerTotals || providerTotals.totalTokens === 0 || totals.totalTokens === 0) {
    return totals;
  }

  return {
    totalTokens: totals.totalTokens,
    totalCostUsd: providerTotals.totalCostUsd * (totals.totalTokens / providerTotals.totalTokens),
  };
}

function getPeriodDateFilter(
  period: LeaderboardPeriod,
  now: Date,
): DateFilter | undefined {
  const range = getPeriodRange(period, now);
  return range.start && range.end
    ? { gte: range.start, lt: range.end }
    : undefined;
}

function isMemberUsageRange(period: MemberUsageRequestPeriod): period is MemberUsageRange {
  return period === "7d" || period === "30d";
}

function getMemberUsageRangeDays(range: MemberUsageRange): number {
  return range === "7d" ? 7 : 30;
}

function uniqueProvidersForModels(
  models: MemberUsageModelFilter[],
): MemberUsageFilters["providers"] {
  return [...new Set(models.map((model) => model.provider))];
}

function dateProviderKey(date: Date, provider: string): string {
  return `${toIsoDate(date)}:${provider}`;
}

function deviceProviderKey(deviceId: string, provider: string): string {
  return `${deviceId}:${provider}`;
}

function usageWhere(
  memberId: string,
  dateFilter?: DateFilter,
  filters: Partial<MemberUsageFilters> = {},
) {
  return {
    memberId,
    ...(dateFilter ? { date: dateFilter } : {}),
    ...(filters.providers && filters.providers.length > 0
      ? { provider: { in: filters.providers } }
      : {}),
    ...(filters.devices && filters.devices.length > 0
      ? { deviceId: { in: filters.devices } }
      : {}),
    ...(filters.models && filters.models.length > 0
      ? {
          OR: filters.models.map((model) => ({
            provider: model.provider,
            modelName: model.modelName,
          })),
        }
      : {}),
  };
}

function sumToTotals(row: SumRow): {
  totalTokens: number;
  totalCostUsd: number;
} {
  return {
    totalTokens: bigIntToSafeNumber(row._sum.totalTokens ?? 0n),
    totalCostUsd: row._sum.costUsd == null ? 0 : Number(row._sum.costUsd),
  };
}

function zeroFillTrend(
  dates: string[],
  rows: Array<SumRow & { date: Date }>,
): MemberUsageDetail["trend"] {
  const totalsByDate = new Map(
    rows.map((row) => [toIsoDate(row.date), sumToTotals(row)]),
  );

  return dates.map((date) => ({
    date,
    ...(totalsByDate.get(date) ?? { totalTokens: 0, totalCostUsd: 0 }),
  }));
}

function dateWindowFilter(startDate: string, endDate: string): DateFilter {
  return {
    gte: utcDate(startDate),
    lt: addUtcDays(utcDate(endDate), 1),
  };
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseProvider(
  provider: string,
): MemberUsageDetail["providers"][number]["provider"] | null {
  const parsed = providerSchema.safeParse(provider);
  return parsed.success ? parsed.data : null;
}

function parseOperatingSystem(
  os: string | undefined,
): PublicOperatingSystem | null {
  if (!os) return null;
  return publicOperatingSystems.includes(os as PublicOperatingSystem)
    ? (os as PublicOperatingSystem)
    : null;
}
