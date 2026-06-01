import type { LeaderboardPeriod, LeaderboardRow } from "@token-burn/shared";

import { prisma } from "../lib/prisma";
import { getPeriodRange } from "../lib/time";

export type RawRow = { displayName: string; totalTokens: bigint };

export function rankRows(rows: RawRow[]): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => {
      if (a.totalTokens === b.totalTokens) return 0;
      return a.totalTokens > b.totalTokens ? -1 : 1;
    })
    .map((row, index) => ({
      rank: index + 1,
      displayName: row.displayName,
      totalTokens: Number(row.totalTokens),
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

  const rows = await prisma.member.findMany({
    select: {
      displayName: true,
      usage: {
        where: dateFilter ? { date: dateFilter } : {},
        select: { totalTokens: true },
      },
    },
  });

  return rankRows(
    rows.map((row) => ({
      displayName: row.displayName,
      totalTokens: row.usage.reduce((sum, usage) => sum + usage.totalTokens, 0n),
    })),
  ).filter((row) => row.totalTokens > 0);
}
