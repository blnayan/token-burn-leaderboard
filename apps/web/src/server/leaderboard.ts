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

const publicOperatingSystems = ["darwin", "linux", "win32"] as const;
type PublicOperatingSystem = (typeof publicOperatingSystems)[number];
export type MemberUsageRequestPeriod = LeaderboardPeriod | MemberUsageRange;

export async function getMemberUsageDetail(
  username: string,
  period: MemberUsageRequestPeriod,
  now = new Date(),
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

  const summaryWhere = usageWhere(member.id, summaryDateFilter);
  const trendDateFilter = trendDates
    ? dateWindowFilter(
        trendDates[0] as string,
        trendDates[trendDates.length - 1] as string,
      )
    : summaryDateFilter;

  const [summary, trendRows, providerRows, modelRows, deviceRows] =
    await Promise.all([
      prisma.dailyProviderUsage.aggregate({
        _sum: { totalTokens: true, costUsd: true },
        where: summaryWhere,
      }),
      prisma.dailyProviderUsage.groupBy({
        by: ["date"],
        _sum: { totalTokens: true, costUsd: true },
        where: usageWhere(member.id, trendDateFilter),
        orderBy: { date: "asc" },
      }),
      prisma.dailyProviderUsage.groupBy({
        by: ["provider"],
        _sum: { totalTokens: true, costUsd: true },
        where: summaryWhere,
        orderBy: { _sum: { totalTokens: "desc" } },
      }),
      prisma.dailyModelUsage.groupBy({
        by: ["provider", "modelName"],
        _sum: { totalTokens: true, costUsd: true },
        where: summaryWhere,
        orderBy: { _sum: { totalTokens: "desc" } },
        take: 5,
      }),
      prisma.dailyProviderUsage.groupBy({
        by: ["deviceId"],
        _sum: { totalTokens: true, costUsd: true },
        where: summaryWhere,
        orderBy: { _sum: { totalTokens: "desc" } },
        take: 5,
      }),
    ]);

  const devices = await prisma.device.findMany({
    where: {
      id: {
        in: deviceRows.map((row) => row.deviceId),
      },
    },
    select: {
      id: true,
      name: true,
      os: true,
    },
  });
  const devicesById = new Map(devices.map((device) => [device.id, device]));

  return {
    member: {
      username: member.username,
      displayName: member.displayName,
    },
    period,
    summary: {
      rank: null,
      ...sumToTotals(summary),
    },
    trend: trendDates
      ? zeroFillTrend(trendDates, trendRows)
      : trendRows.map((row) => ({
          date: toIsoDate(row.date),
          ...sumToTotals(row),
        })),
    providers: providerRows.flatMap((row) => {
      const provider = parseProvider(row.provider);
      if (!provider) return [];

      return [{ provider, ...sumToTotals(row) }];
    }),
    models: modelRows.flatMap((row) => {
      const provider = parseProvider(row.provider);
      if (!provider) return [];

      return [{ provider, modelName: row.modelName, ...sumToTotals(row) }];
    }),
    devices: deviceRows.flatMap((row) => {
      const device = devicesById.get(row.deviceId);
      const os = parseOperatingSystem(device?.os);
      if (!device || !os) return [];

      return [{ deviceName: device.name, os, ...sumToTotals(row) }];
    }),
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

function usageWhere(memberId: string, dateFilter?: DateFilter) {
  return dateFilter ? { memberId, date: dateFilter } : { memberId };
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
