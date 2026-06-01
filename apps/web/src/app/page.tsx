import { periodSchema, type LeaderboardPeriod } from "@token-burn/shared";

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
  const rows = await getLeaderboard(period);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-5 border-b pb-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">Token Burn</h1>
          <p className="text-sm text-muted-foreground">Public leaderboard. Private submissions.</p>
        </div>
        <PeriodTabs value={period} />
      </header>
      <LeaderboardTable rows={rows} />
    </main>
  );
}
