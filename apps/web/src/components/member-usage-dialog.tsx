"use client";

import {
  type LeaderboardPeriod,
  type MemberUsageDetail,
  formatTokens,
  formatUsd,
  memberUsageDetailSchema,
} from "@token-burn/shared";
import React from "react";

import { MemberUsageCharts } from "@/components/member-usage-charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type MemberSummary = { username: string; displayName: string; rank: number };

type LoadState =
  | { status: "idle" | "loading" | "error"; detail: null }
  | { status: "success"; detail: MemberUsageDetail };

export function MemberUsageDialog({
  member,
  period,
  open,
  onOpenChange,
}: {
  member: MemberSummary | null;
  period: LeaderboardPeriod;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = React.useState<LoadState>({ status: "idle", detail: null });
  const [retryNonce, setRetryNonce] = React.useState(0);

  React.useEffect(() => {
    if (!open || !member) {
      setState({ status: "idle", detail: null });
      return;
    }

    let ignore = false;
    const username = member.username;

    async function loadUsage() {
      setState({ status: "loading", detail: null });

      try {
        const response = await fetch(
          `/api/leaderboard/members/${encodeURIComponent(username)}?period=${period}`,
        );

        if (!response.ok) {
          throw new Error("Member usage request failed");
        }

        const json = await response.json();
        const detail = memberUsageDetailSchema.parse(json);

        if (!ignore) {
          setState({ status: "success", detail });
        }
      } catch {
        if (!ignore) {
          setState({ status: "error", detail: null });
        }
      }
    }

    void loadUsage();

    return () => {
      ignore = true;
    };
  }, [open, member, period, retryNonce]);

  const title = state.status === "success" ? state.detail.member.displayName : member?.displayName ?? "Member";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Usage details for the selected leaderboard period.</DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? <MemberUsageLoading /> : null}

        {state.status === "error" ? (
          <div className="flex flex-col items-start gap-3 rounded-md border bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">Could not load member usage.</p>
            <Button size="sm" onClick={() => setRetryNonce((value) => value + 1)}>
              Retry
            </Button>
          </div>
        ) : null}

        {state.status === "success" ? (
          <div className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryCard label="Rank" value={`#${state.detail.summary.rank ?? member?.rank ?? "-"}`} />
              <SummaryCard label="Tokens" value={formatTokens(state.detail.summary.totalTokens)} />
              <SummaryCard label="Cost" value={formatUsd(state.detail.summary.totalCostUsd)} />
            </div>
            <MemberUsageCharts detail={state.detail} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MemberUsageLoading() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading member usage...">
      <p className="text-sm text-muted-foreground">Loading member usage...</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-[220px]" />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="rounded-md shadow-none">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="font-mono text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
