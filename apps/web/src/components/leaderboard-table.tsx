import { formatTokens, formatUsd, type LeaderboardRow } from "@token-burn/shared";
import React from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border bg-card p-8 text-sm text-muted-foreground">
        No tokens burned yet.
      </div>
    );
  }

  return (
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
              <TableCell className="font-medium">{row.displayName}</TableCell>
              <TableCell className="text-right font-mono">{formatTokens(row.totalTokens)}</TableCell>
              <TableCell className="text-right font-mono">{formatUsd(row.totalCostUsd)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
