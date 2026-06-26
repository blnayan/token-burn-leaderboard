import {
  providerSchema,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type MemberUsageDetail,
  type MemberUsageRange,
} from "@token-burn/shared";

import { prisma } from "../lib/prisma";
import { getPeriodRange, getRecentUtcDateWindow } from "../lib/time";
import {
  emptyMemberUsageFilters,
  type MemberUsageFilters,
  type MemberUsageQuery,
  type MemberUsageRequestPeriod,
} from "./member-usage-query";

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

type MemberUsagePeriodPlan = {
  summaryDateFilter: DateFilter | undefined;
  trendDateFilter: DateFilter | undefined;
  trendDates: string[] | null;
};

type MemberUsageQueryPlan = {
  hasModelFilters: boolean;
  summaryWhere: ReturnType<typeof usageWhere>;
  trendWhere: ReturnType<typeof usageWhere>;
  breakdownWhere: ReturnType<typeof usageWhere>;
  providerCostWhere: ReturnType<typeof usageWhere> | null;
  providerTrendCostWhere: ReturnType<typeof usageWhere> | null;
};

const publicOperatingSystems = ["darwin", "linux", "win32"] as const;
type PublicOperatingSystem = (typeof publicOperatingSystems)[number];

export async function getMemberUsageDetail(
  username: string,
  query: MemberUsageQuery,
  now = new Date(),
): Promise<MemberUsageDetail | null> {
  const { period, filters = emptyMemberUsageFilters } = query;

  const member = await prisma.member.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
    },
  });

  if (!member) return null;

  const periodPlan = planMemberUsagePeriod(period, now);
  const queryPlan = planMemberUsageQueries(member.id, filters, periodPlan);

  const [
    summary,
    trendRows,
    providerRows,
    modelRows,
    providerCostRows,
    providerTrendCostRows,
    deviceRows,
  ] = await Promise.all([
    queryPlan.hasModelFilters
      ? prisma.dailyModelUsage.groupBy({
          by: ["provider", "modelName"],
          _sum: { totalTokens: true, costUsd: true },
          where: queryPlan.summaryWhere,
        })
      : prisma.dailyProviderUsage.aggregate({
          _sum: { totalTokens: true, costUsd: true },
          where: queryPlan.summaryWhere,
        }),
    queryPlan.hasModelFilters
      ? prisma.dailyModelUsage.groupBy({
          by: ["date", "provider", "modelName"],
          _sum: { totalTokens: true, costUsd: true },
          where: queryPlan.trendWhere,
          orderBy: { date: "asc" },
        })
      : prisma.dailyProviderUsage.groupBy({
          by: ["date"],
          _sum: { totalTokens: true, costUsd: true },
          where: queryPlan.trendWhere,
          orderBy: { date: "asc" },
        }),
    prisma.dailyProviderUsage.groupBy({
      by: ["provider"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.breakdownWhere,
      orderBy: { _sum: { totalTokens: "desc" } },
    }),
    prisma.dailyModelUsage.groupBy({
      by: ["provider", "modelName"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.breakdownWhere,
      orderBy: { _sum: { totalTokens: "desc" } },
    }),
    queryPlan.providerCostWhere
      ? prisma.dailyProviderUsage.groupBy({
          by: ["provider"],
          _sum: { totalTokens: true, costUsd: true },
          where: queryPlan.providerCostWhere,
          orderBy: { _sum: { totalTokens: "desc" } },
        })
      : Promise.resolve(null),
    queryPlan.providerTrendCostWhere
      ? prisma.dailyProviderUsage.groupBy({
          by: ["date", "provider"],
          _sum: { totalTokens: true, costUsd: true },
          where: queryPlan.providerTrendCostWhere,
          orderBy: { date: "asc" },
        })
      : Promise.resolve(null),
    prisma.dailyProviderUsage.groupBy({
      by: ["deviceId"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.breakdownWhere,
      orderBy: { _sum: { totalTokens: "desc" } },
    }),
  ]);

  const breakdownProviderTotalsByProvider = totalsByProvider(providerRows);
  const summaryProviderTotalsByProvider = totalsByProvider(
    providerCostRows ?? providerRows,
  );
  const providerTrendTotalsByDateProvider = totalsByDateProvider(
    providerTrendCostRows ?? [],
  );
  const deviceTotals = (deviceRows as Array<SumRow & { deviceId: string }>).map(
    (row) => ({
      deviceId: row.deviceId,
      ...sumToTotals(row),
    }),
  );

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
  const summaryTotals = queryPlan.hasModelFilters
    ? modelRowsToTotals(
        summary as Array<SumRow & { provider: string }>,
        summaryProviderTotalsByProvider,
      )
    : sumToTotals(summary as SumRow);
  const trend = queryPlan.hasModelFilters
    ? modelTrendRowsToTrend(
        trendRows as Array<SumRow & { date: Date; provider: string }>,
        providerTrendTotalsByDateProvider,
        periodPlan.trendDates,
      )
    : periodPlan.trendDates
      ? zeroFillTrend(
          periodPlan.trendDates,
          trendRows as Array<SumRow & { date: Date }>,
        )
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
    providers: mapProviderBreakdownRows(providerRows),
    models: mapModelBreakdownRows(modelRows, breakdownProviderTotalsByProvider),
    devices: mapDeviceBreakdownRows(deviceTotals, devicesById),
  };
}

function modelToTotals(
  row: SumRow & { provider: string },
  providerTotalsByProvider: Map<
    string,
    { totalTokens: number; totalCostUsd: number }
  >,
): {
  totalTokens: number;
  totalCostUsd: number;
} {
  const totals = sumToTotals(row);
  if (row._sum.costUsd != null) return totals;

  const providerTotals = providerTotalsByProvider.get(row.provider);
  if (
    !providerTotals ||
    providerTotals.totalTokens === 0 ||
    totals.totalTokens === 0
  ) {
    return totals;
  }

  return {
    totalTokens: totals.totalTokens,
    totalCostUsd:
      providerTotals.totalCostUsd *
      (totals.totalTokens / providerTotals.totalTokens),
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
    const current = totalsByDate.get(date) ?? {
      totalTokens: 0,
      totalCostUsd: 0,
    };
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

function modelToTotalsForProvider(
  row: SumRow,
  providerTotals: UsageTotals | undefined,
): UsageTotals {
  const totals = sumToTotals(row);
  if (row._sum.costUsd != null) return totals;

  if (
    !providerTotals ||
    providerTotals.totalTokens === 0 ||
    totals.totalTokens === 0
  ) {
    return totals;
  }

  return {
    totalTokens: totals.totalTokens,
    totalCostUsd:
      providerTotals.totalCostUsd *
      (totals.totalTokens / providerTotals.totalTokens),
  };
}

function totalsByProvider(
  rows: Array<SumRow & { provider: string }>,
): Map<string, UsageTotals> {
  return new Map(rows.map((row) => [row.provider, sumToTotals(row)]));
}

function totalsByDateProvider(
  rows: Array<SumRow & { date: Date; provider: string }>,
): Map<string, UsageTotals> {
  return new Map(
    rows.map((row) => [
      dateProviderKey(row.date, row.provider),
      sumToTotals(row),
    ]),
  );
}

function mapProviderBreakdownRows(
  rows: Array<SumRow & { provider: string }>,
): MemberUsageDetail["providers"] {
  return rows.flatMap((row) => {
    const provider = parseProvider(row.provider);
    if (!provider) return [];

    return [{ provider, ...sumToTotals(row) }];
  });
}

function mapModelBreakdownRows(
  rows: Array<SumRow & { provider: string; modelName: string }>,
  providerTotalsByProvider: Map<string, UsageTotals>,
): MemberUsageDetail["models"] {
  return rows.flatMap((row) => {
    const provider = parseProvider(row.provider);
    if (!provider) return [];

    return [
      {
        provider,
        modelName: row.modelName,
        ...modelToTotals(row, providerTotalsByProvider),
      },
    ];
  });
}

function mapDeviceBreakdownRows(
  deviceTotals: Array<UsageTotals & { deviceId: string }>,
  devicesById: Map<string, { id: string; name: string; os: string }>,
): MemberUsageDetail["devices"] {
  return deviceTotals.flatMap((row) => {
    const device = devicesById.get(row.deviceId);
    const os = parseOperatingSystem(device?.os);
    if (!device || !os) return [];

    return [{ deviceName: device.name, os, ...row }];
  });
}

function planMemberUsagePeriod(
  period: MemberUsageRequestPeriod,
  now: Date,
): MemberUsagePeriodPlan {
  if (isMemberUsageRange(period)) {
    const trendDates = getRecentUtcDateWindow(
      getMemberUsageRangeDays(period),
      now,
    );
    const summaryDateFilter = dateWindowFilter(
      trendDates[0] as string,
      trendDates[trendDates.length - 1] as string,
    );

    return {
      summaryDateFilter,
      trendDateFilter: summaryDateFilter,
      trendDates,
    };
  }

  const summaryDateFilter = getPeriodDateFilter(period, now);
  const trendDates =
    period === "all-time" ? getRecentUtcDateWindow(30, now) : null;
  const trendDateFilter = trendDates
    ? dateWindowFilter(
        trendDates[0] as string,
        trendDates[trendDates.length - 1] as string,
      )
    : summaryDateFilter;

  return {
    summaryDateFilter,
    trendDateFilter,
    trendDates,
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

function isMemberUsageRange(
  period: MemberUsageRequestPeriod,
): period is MemberUsageRange {
  return period === "7d" || period === "30d";
}

function getMemberUsageRangeDays(range: MemberUsageRange): number {
  return range === "7d" ? 7 : 30;
}

function uniqueProvidersForModels(
  models: MemberUsageFilters["models"],
): MemberUsageFilters["providers"] {
  return [...new Set(models.map((model) => model.provider))];
}

function dateProviderKey(date: Date, provider: string): string {
  return `${toIsoDate(date)}:${provider}`;
}

function planMemberUsageQueries(
  memberId: string,
  filters: MemberUsageFilters,
  periodPlan: MemberUsagePeriodPlan,
): MemberUsageQueryPlan {
  const hasModelFilters = filters.models.length > 0;
  const summaryFilters = hasModelFilters
    ? { models: filters.models, devices: filters.devices }
    : { providers: filters.providers, devices: filters.devices };
  const providerCostFilters = hasModelFilters
    ? {
        providers: uniqueProvidersForModels(filters.models),
        devices: filters.devices,
      }
    : {};

  return {
    hasModelFilters,
    summaryWhere: usageWhere(
      memberId,
      periodPlan.summaryDateFilter,
      summaryFilters,
    ),
    trendWhere: usageWhere(
      memberId,
      periodPlan.trendDateFilter,
      summaryFilters,
    ),
    breakdownWhere: usageWhere(memberId, periodPlan.summaryDateFilter),
    providerCostWhere: hasModelFilters
      ? usageWhere(memberId, periodPlan.summaryDateFilter, providerCostFilters)
      : null,
    providerTrendCostWhere: hasModelFilters
      ? usageWhere(memberId, periodPlan.trendDateFilter, providerCostFilters)
      : null,
  };
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
