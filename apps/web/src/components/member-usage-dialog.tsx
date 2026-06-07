"use client";

import {
  type MemberUsageRange,
  type MemberUsageDetail,
  formatTokens,
  formatUsd,
  memberUsageDetailSchema,
} from "@token-burn/shared";
import React from "react";

import {
  type MemberUsageSelectedFilters,
  type MemberUsageModelFilter,
  MemberUsageCharts,
} from "@/components/member-usage-charts";
import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type MemberSummary = { username: string; displayName: string; rank: number };

type MemberUsageDialogProps = {
  member: MemberSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type LoadState =
  | { status: "idle" | "loading"; detail: null }
  | { status: "error"; detail: MemberUsageDetail | null }
  | { status: "success"; detail: MemberUsageDetail; isRefreshing: boolean };

const usageRanges: { label: string; value: MemberUsageRange }[] = [
  { label: "Past 7 days", value: "7d" },
  { label: "Past 30 days", value: "30d" },
];

const emptySelectedFilters: MemberUsageSelectedFilters = {
  providers: [],
  models: [],
  devices: [],
};

export function MemberUsageDialog({
  member,
  open,
  onOpenChange,
}: MemberUsageDialogProps) {
  return (
    <MemberUsageDialogInner
      key={member?.username ?? "no-member"}
      member={member}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

function MemberUsageDialogInner({
  member,
  open,
  onOpenChange,
}: MemberUsageDialogProps) {
  const [state, setState] = React.useState<LoadState>({ status: "idle", detail: null });
  const [retryNonce, setRetryNonce] = React.useState(0);
  const [rangeState, setRangeState] = React.useState<{ username: string; range: MemberUsageRange }>({
    username: "",
    range: "7d",
  });
  const [filterState, setFilterState] = React.useState<{
    username: string;
    range: MemberUsageRange;
    filters: MemberUsageSelectedFilters;
  }>({
    username: "",
    range: "7d",
    filters: emptySelectedFilters,
  });
  const selectedRange = member && rangeState.username === member.username ? rangeState.range : "7d";
  const selectedFilters =
    member && filterState.username === member.username && filterState.range === selectedRange
      ? filterState.filters
      : emptySelectedFilters;

  const updateFilters = React.useCallback(
    (updater: (filters: MemberUsageSelectedFilters) => MemberUsageSelectedFilters) => {
      if (!member) return;

      setFilterState((current) => {
        const currentFilters =
          current.username === member.username && current.range === selectedRange
            ? current.filters
            : emptySelectedFilters;

        return {
          username: member.username,
          range: selectedRange,
          filters: updater(currentFilters),
        };
      });
    },
    [member, selectedRange],
  );

  const toggleProvider = React.useCallback(
    (provider: MemberUsageDetail["providers"][number]["provider"]) => {
      updateFilters((filters) => {
        const selected = filters.providers.includes(provider);

        return {
          providers: selected
            ? filters.providers.filter((selectedProvider) => selectedProvider !== provider)
            : [...filters.providers, provider],
          models: [],
          devices: filters.devices,
        };
      });
    },
    [updateFilters],
  );

  const toggleModel = React.useCallback(
    (model: MemberUsageModelFilter) => {
      updateFilters((filters) => {
        const selected = filters.models.some((selectedModel) => isSameModelFilter(selectedModel, model));

        return {
          providers: [],
          models: selected
            ? filters.models.filter((selectedModel) => !isSameModelFilter(selectedModel, model))
            : [...filters.models, model],
          devices: filters.devices,
        };
      });
    },
    [updateFilters],
  );

  const toggleDevice = React.useCallback(
    (deviceId: MemberUsageDetail["devices"][number]["deviceId"]) => {
      updateFilters((filters) => {
        const selected = filters.devices.includes(deviceId);

        return {
          ...filters,
          devices: selected
            ? filters.devices.filter((selectedDeviceId) => selectedDeviceId !== deviceId)
            : [...filters.devices, deviceId],
        };
      });
    },
    [updateFilters],
  );

  React.useEffect(() => {
    if (!open || !member) return;

    let ignore = false;
    const username = member.username;

    async function loadUsage() {
      setState((current) =>
        current.detail
          ? { status: "success", detail: current.detail, isRefreshing: true }
          : { status: "loading", detail: null },
      );

      try {
        const response = await fetch(buildMemberUsageUrl(username, selectedRange, selectedFilters));

        if (!response.ok) {
          throw new Error("Member usage request failed");
        }

        const json = await response.json();
        const detail = memberUsageDetailSchema.parse(json);

        if (!ignore) {
          setState({ status: "success", detail, isRefreshing: false });
        }
      } catch {
        if (!ignore) {
          setState((current) =>
            current.detail ? { status: "error", detail: current.detail } : { status: "error", detail: null },
          );
        }
      }
    }

    void loadUsage();

    return () => {
      ignore = true;
    };
  }, [open, member, selectedRange, selectedFilters, retryNonce]);

  const title = state.detail?.member.displayName ?? member?.displayName ?? "Member";
  const rank = state.detail?.summary.rank ?? member?.rank ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{title}</span>
            {rank ? (
              <Badge variant="secondary" aria-hidden="true">
                #{rank}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>Usage details for the selected range.</DialogDescription>
        </DialogHeader>

        {member ? (
          <Tabs
            value={selectedRange}
            onValueChange={(value) => {
              if (!member || (value !== "7d" && value !== "30d")) return;
              setRangeState({ username: member.username, range: value });
              setFilterState({
                username: member.username,
                range: value,
                filters: emptySelectedFilters,
              });
            }}
          >
            <TabsList>
              {usageRanges.map((range) => (
                <TabsTrigger key={range.value} value={range.value}>
                  {range.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}

        {state.status === "loading" ? <MemberUsageLoading /> : null}

        {state.status === "error" ? (
          <div className="flex flex-col items-start gap-3 rounded-md border bg-muted/20 p-4">
            <p className="text-sm text-muted-foreground">Could not load member usage.</p>
            <Button size="sm" onClick={() => setRetryNonce((value) => value + 1)}>
              Retry
            </Button>
          </div>
        ) : null}

        {state.detail ? (
          <div className="flex flex-col gap-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryCard label="Tokens" value={formatTokens(state.detail.summary.totalTokens)} />
              <SummaryCard label="Cost" value={formatUsd(state.detail.summary.totalCostUsd)} />
            </div>
            <MemberUsageCharts
              detail={state.detail}
              selectedFilters={selectedFilters}
              onToggleDevice={toggleDevice}
              onToggleModel={toggleModel}
              onToggleProvider={toggleProvider}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function buildMemberUsageUrl(
  username: string,
  range: MemberUsageRange,
  filters: MemberUsageSelectedFilters,
): string {
  const params = new URLSearchParams({ range });

  for (const provider of filters.providers) {
    params.append("provider", provider);
  }

  for (const model of filters.models) {
    params.append("model", `${model.provider}:${model.modelName}`);
  }

  for (const device of filters.devices) {
    params.append("device", device);
  }

  return `/api/leaderboard/members/${encodeURIComponent(username)}?${params.toString()}`;
}

function isSameModelFilter(
  left: MemberUsageModelFilter,
  right: MemberUsageModelFilter,
): boolean {
  return left.provider === right.provider && left.modelName === right.modelName;
}

function MemberUsageLoading() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading member usage...">
      <p className="text-sm text-muted-foreground">Loading member usage...</p>
      <div className="grid gap-3 sm:grid-cols-2">
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
