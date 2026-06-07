import type { LeaderboardPeriod, LeaderboardRow } from "@token-burn/shared";

import { prisma } from "../lib/prisma";
import { getPeriodRange } from "../lib/time";

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
      if (a.totalTokens === b.totalTokens) return a.displayName.localeCompare(b.displayName);
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

export async function getLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
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

  const positiveTotals = totals.filter((total) => (total._sum.totalTokens ?? 0n) > 0n);
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
  const membersByMemberId = new Map(members.map((member) => [member.id, member]));

  return rankRows(
    positiveTotals.flatMap((total) => {
      const member = membersByMemberId.get(total.memberId);
      const totalTokens = total._sum.totalTokens;
      const totalCostUsd = total._sum.costUsd === null ? 0 : Number(total._sum.costUsd);

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
