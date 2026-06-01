import { formatTokens, type LeaderboardRow } from "@token-burn/shared";

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
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.displayName}>
              <TableCell className="font-mono text-muted-foreground">#{row.rank}</TableCell>
              <TableCell className="font-medium">{row.displayName}</TableCell>
              <TableCell className="text-right font-mono">{formatTokens(row.totalTokens)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
