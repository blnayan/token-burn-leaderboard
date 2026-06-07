"use client";

import { type MemberUsageDetail, formatTokens, formatUsd } from "@token-burn/shared";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const chartConfig = {
  totalTokens: {
    label: "Tokens",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function MemberUsageCharts({ detail }: { detail: MemberUsageDetail }) {
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
            No usage in this period.
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
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
            label: formatProvider(item.provider),
            tokens: item.totalTokens,
            costUsd: item.totalCostUsd,
          }))}
        />
        <Breakdown
          title="Models"
          items={detail.models.map((item) => ({
            label: item.modelName,
            meta: formatProvider(item.provider),
            tokens: item.totalTokens,
            costUsd: item.totalCostUsd,
          }))}
        />
        <Breakdown
          title="Devices"
          items={detail.devices.map((item) => ({
            label: item.deviceName,
            meta: formatOs(item.os),
            tokens: item.totalTokens,
            costUsd: item.totalCostUsd,
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
  items: { label: string; meta?: string; tokens: number; costUsd: number }[];
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
          {items.map((item, index) => (
            <div key={`${item.label}-${item.meta ?? ""}-${index}`} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  {item.meta ? <p className="text-xs text-muted-foreground">{item.meta}</p> : null}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm">{formatTokens(item.tokens)}</p>
                  <p className="font-mono text-xs text-muted-foreground">{formatUsd(item.costUsd)}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
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
