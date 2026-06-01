import type { LeaderboardPeriod } from "@token-burn/shared";
import Link from "next/link";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const periods: { label: string; value: LeaderboardPeriod }[] = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "All-time", value: "all-time" },
];

export function PeriodTabs({ value }: { value: LeaderboardPeriod }) {
  return (
    <Tabs value={value}>
      <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
        {periods.map((period) => (
          <TabsTrigger key={period.value} value={period.value} asChild>
            <Link href={`/?period=${period.value}`}>{period.label}</Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
