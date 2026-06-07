"use client";

import { formatTokens, formatUsd, type LeaderboardPeriod, type LeaderboardRow } from "@token-burn/shared";
import React from "react";

import { MemberUsageDialog } from "@/components/member-usage-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SelectedMember = { username: string; displayName: string; rank: number };

export function LeaderboardTable({ period, rows }: { period: LeaderboardPeriod; rows: LeaderboardRow[] }) {
  const [selectedMember, setSelectedMember] = React.useState<SelectedMember | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-card p-8 text-sm text-muted-foreground">
        No tokens burned yet.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Rank</TableHead>
              <TableHead>Display Name</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rank}>
                <TableCell className="font-mono text-muted-foreground">#{row.rank}</TableCell>
                <TableCell className="font-medium">
                  <button
                    type="button"
                    aria-label={`Open usage details for ${row.displayName}`}
                    className="-mx-1 rounded px-1 text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() =>
                      setSelectedMember({
                        username: row.username,
                        displayName: row.displayName,
                        rank: row.rank,
                      })
                    }
                  >
                    {row.displayName}
                  </button>
                </TableCell>
                <TableCell className="text-right font-mono">{formatTokens(row.totalTokens)}</TableCell>
                <TableCell className="text-right font-mono">{formatUsd(row.totalCostUsd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <MemberUsageDialog
        member={selectedMember}
        period={period}
        open={selectedMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedMember(null);
          }
        }}
      />
    </>
  );
}
