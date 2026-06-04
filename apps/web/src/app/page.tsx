import { periodSchema, type LeaderboardPeriod } from "@token-burn/shared";
import React from "react";

import { auth } from "@/auth";
import { AppNav } from "@/components/app-nav";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { PeriodTabs } from "@/components/period-tabs";
import { getLeaderboard } from "@/server/leaderboard";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period: LeaderboardPeriod = periodSchema.catch("daily").parse(params.period);
  const [rows, session] = await Promise.all([getLeaderboard(period), auth()]);
  const appNav = await AppNav({ session, currentPath: "/" });

  return (
    <>
      {appNav}
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <h1 className="text-2xl font-semibold">Leaderboard</h1>
          <PeriodTabs value={period} />
        </header>
        <LeaderboardTable rows={rows} />
      </main>
    </>
  );
}
