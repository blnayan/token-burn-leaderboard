"use client";

import { type MemberUsageDetail, formatTokens, formatUsd } from "@token-burn/shared";
import React from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const memberUsageChartConfig = {
  totalTokens: {
    label: "Tokens",
    theme: {
      light: "var(--color-blue-500)",
      dark: "var(--color-blue-400)",
    },
  },
} satisfies ChartConfig;

export type MemberUsageProviderFilter = MemberUsageDetail["providers"][number]["provider"];

export type MemberUsageModelFilter = Pick<
  MemberUsageDetail["models"][number],
  "modelName" | "provider"
>;

export type MemberUsageSelectedFilters = {
  providers: MemberUsageProviderFilter[];
  models: MemberUsageModelFilter[];
  devices: MemberUsageDetail["devices"][number]["deviceId"][];
};

const emptySelectedFilters: MemberUsageSelectedFilters = {
  providers: [],
  models: [],
  devices: [],
};

export function MemberUsageCharts({
  detail,
  selectedFilters = emptySelectedFilters,
  onToggleDevice,
  onToggleModel,
  onToggleProvider,
}: {
  detail: MemberUsageDetail;
  selectedFilters?: MemberUsageSelectedFilters;
  onToggleDevice?: (deviceId: MemberUsageDetail["devices"][number]["deviceId"]) => void;
  onToggleModel?: (model: MemberUsageModelFilter) => void;
  onToggleProvider?: (provider: MemberUsageProviderFilter) => void;
}) {
  const hasActiveFilters = hasSelectedFilters(selectedFilters);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="member-usage-trend">
        <div className="flex items-center justify-between gap-3">
          <h3 id="member-usage-trend" className="text-sm font-medium">
            Token trend
          </h3>
          <p className="text-xs text-muted-foreground">{formatUsd(detail.summary.totalCostUsd)}</p>
        </div>
        {detail.trend.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center rounded-md border bg-muted/20 text-sm text-muted-foreground">
            {hasActiveFilters ? "No usage for these filters." : "No usage in this period."}
          </div>
        ) : (
          <ChartContainer config={memberUsageChartConfig} className="h-[220px] w-full">
            <BarChart accessibilityLayer data={detail.trend}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={24}
                tickFormatter={formatDateTick}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => String(value)}
                    formatter={(value, _name, item) => (
                      <TrendTooltipValue
                        costUsd={getTrendPointCost(item.payload)}
                        tokens={typeof value === "number" ? value : 0}
                      />
                    )}
                  />
                }
              />
              <Bar dataKey="totalTokens" fill="var(--color-totalTokens)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Breakdown
          title="Providers"
          items={detail.providers.map((item) => ({
            key: item.provider,
            label: formatProvider(item.provider),
            tokens: item.totalTokens,
            costUsd: item.totalCostUsd,
            selected: selectedFilters.providers.includes(item.provider),
            onToggle: () => onToggleProvider?.(item.provider),
          }))}
        />
        <Breakdown
          title="Models"
          items={detail.models.map((item) => ({
            key: `${item.provider}:${item.modelName}`,
            label: item.modelName,
            meta: formatProvider(item.provider),
            tokens: item.totalTokens,
            costUsd: item.totalCostUsd,
            selected: selectedFilters.models.some((model) => isSameModelFilter(model, item)),
            onToggle: () =>
              onToggleModel?.({ provider: item.provider, modelName: item.modelName }),
          }))}
        />
        <Breakdown
          title="Devices"
          items={detail.devices.map((item) => ({
            key: item.deviceId,
            label: item.deviceName,
            meta: formatOs(item.os),
            tokens: item.totalTokens,
            costUsd: item.totalCostUsd,
            selected: selectedFilters.devices.includes(item.deviceId),
            onToggle: () => onToggleDevice?.(item.deviceId),
          }))}
        />
      </div>
    </div>
  );
}

function Breakdown({
  title,
  items,
}: {
  title: string;
  items: {
    key: string;
    label: string;
    meta?: string;
    tokens: number;
    costUsd: number;
    selected: boolean;
    onToggle: () => void;
  }[];
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby={`member-usage-${title.toLowerCase()}`}>
      <h3 id={`member-usage-${title.toLowerCase()}`} className="text-sm font-medium">
        {title}
      </h3>
      {items.length === 0 ? (
        <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">No data.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <Button
              key={item.key}
              type="button"
              variant="outline"
              data-selected={item.selected}
              className={cn(
                "h-auto w-full justify-between p-3 text-left shadow-none",
                item.selected && "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
              aria-pressed={item.selected}
              onClick={item.onToggle}
            >
              <span className="flex min-w-0 flex-col items-start">
                <span className="truncate text-sm font-medium">{item.label}</span>
                {item.meta ? <span className="text-xs text-muted-foreground">{item.meta}</span> : null}
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-sm">{formatTokens(item.tokens)}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {formatUsd(item.costUsd)}
                </span>
              </span>
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function hasSelectedFilters(filters: MemberUsageSelectedFilters): boolean {
  return filters.providers.length > 0 || filters.models.length > 0 || filters.devices.length > 0;
}

function isSameModelFilter(
  left: MemberUsageModelFilter,
  right: MemberUsageModelFilter,
): boolean {
  return left.provider === right.provider && left.modelName === right.modelName;
}

function TrendTooltipValue({ tokens, costUsd }: { tokens: number; costUsd: number }) {
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Tokens</span>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {formatTokens(tokens)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Cost</span>
        <span className="font-mono font-medium tabular-nums text-foreground">
          {formatUsd(costUsd)}
        </span>
      </div>
    </div>
  );
}

function getTrendPointCost(payload: unknown): number {
  if (typeof payload === "object" && payload !== null && "totalCostUsd" in payload) {
    const cost = payload.totalCostUsd;
    return typeof cost === "number" ? cost : 0;
  }

  return 0;
}

function formatDateTick(value: string): string {
  const [, month, day] = value.split("-");
  return month && day ? `${month}/${day}` : value;
}

function formatProvider(provider: MemberUsageDetail["providers"][number]["provider"]): string {
  if (provider === "claude_code") return "Claude Code";
  return "Codex";
}

function formatOs(os: MemberUsageDetail["devices"][number]["os"]): string {
  if (os === "darwin") return "macOS";
  if (os === "win32") return "Windows";
  return "Linux";
}
