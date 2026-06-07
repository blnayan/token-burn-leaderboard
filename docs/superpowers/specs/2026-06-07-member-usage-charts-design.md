# Member Usage Charts Design

## Summary

Token Burn should let anyone who can view the public leaderboard click a member row and inspect richer aggregate usage details. The detail view opens in a centered shadcn `Dialog`, lazy-loads public member chart data, and renders a compact set of shadcn charts: a primary daily bar chart for token trend, plus provider, model, and device breakdowns.

The feature keeps the existing aggregate-only privacy model. It does not expose prompts, raw sync snapshots, token detail JSON, private auth/session data, CLI tokens, or OAuth/user internals.

## Goals

- Make leaderboard rows clickable so a visitor can inspect a member without leaving the leaderboard.
- Show a compact all-in-one detail view with trend, spend, provider mix, model usage, and device usage.
- Use shadcn UI patterns for the interaction and chart layer.
- Keep the leaderboard page fast by loading member detail data only after a row is selected.
- Keep the detail data public but aggregate-only.
- Preserve the selected leaderboard period where it makes sense.

## Non-Goals

- Build a standalone member profile page.
- Add shareable member detail URLs.
- Add authentication checks around public aggregate details.
- Expose raw `DailyProviderUsage` JSON fields, source snapshots, token details, project/session data, or private user fields.
- Add new ingestion fields or change CLI sync behavior.
- Add filtering controls inside the first version of the dialog.

## Resolved Product Decisions

- The member detail view opens in a centered dialog, not a side sheet or inline table expansion.
- Detail data is public.
- The primary trend chart is a bar chart because usage is stored as discrete daily totals.
- Daily, weekly, and monthly detail ranges follow the selected leaderboard tab.
- All-time detail uses all-time summary totals and breakdowns, plus a recent trend window so the bar chart stays readable.
- The implementation should use the shadcn skill/component conventions.

## shadcn Component Direction

The project already uses shadcn with Radix primitives, lucide icons, TypeScript, Next App Router, and CSS variables. `dialog` is already installed. `chart` and `skeleton` should be added during implementation with the project package runner:

```sh
pnpm dlx shadcn@latest add chart skeleton
```

The shadcn chart component uses Recharts under the hood and is intended for composition with Recharts primitives rather than a custom chart abstraction. The implementation should use:

- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, and `DialogDescription` for the modal structure.
- `ChartContainer` with an explicit height or min-height so Recharts can measure responsively.
- Recharts `BarChart`, `Bar`, `CartesianGrid`, and `XAxis` for the primary usage trend.
- `ChartTooltip` and `ChartTooltipContent` for tokens and cost hover details.
- `ChartConfig` with semantic labels and chart CSS tokens such as `var(--chart-1)`.
- `Skeleton` for the loading state.

References checked while designing:

- <https://ui.shadcn.com/docs/components/radix/chart>
- <https://ui.shadcn.com/docs/components/radix/dialog>
- <https://ui.shadcn.com/docs/components/radix/skeleton>

## User Experience

The leaderboard table keeps the current columns: rank, display name, tokens, and cost. Rows with usage become clickable and keyboard accessible. The selected row opens a centered dialog.

The dialog header shows:

- Display name
- Current period label
- Rank for the selected leaderboard period
- Total tokens
- Total cost

The dialog body shows:

1. A primary daily bar chart for token totals over the detail trend range.
2. Tooltip details for each day, including tokens and cost.
3. Provider breakdown for the detail range.
4. Top model totals for the detail range.
5. Top device totals for the detail range.

For `daily`, `weekly`, and `monthly`, the summary and breakdowns use the same range as the selected leaderboard period. For `all-time`, the summary and breakdowns use all-time totals, while the trend chart uses the most recent 30 UTC calendar dates ending on the server's current UTC date. Missing days in that 30-day window should appear as zero-value bars so the x-axis remains stable.

## Data Model and Public Shape

`LeaderboardRow` should gain a stable public member identifier:

```ts
{
  rank: number;
  username: string;
  displayName: string;
  totalTokens: number;
  totalCostUsd: number;
}
```

The detail response shape should be explicit and serializable:

```ts
{
  member: {
    username: string;
    displayName: string;
  };
  period: "daily" | "weekly" | "monthly" | "all-time";
  summary: {
    rank: number | null;
    totalTokens: number;
    totalCostUsd: number;
  };
  trend: Array<{
    date: string;
    totalTokens: number;
    totalCostUsd: number;
  }>;
  providers: Array<{
    provider: string;
    totalTokens: number;
    totalCostUsd: number;
  }>;
  models: Array<{
    modelName: string;
    provider: string;
    totalTokens: number;
    totalCostUsd: number;
  }>;
  devices: Array<{
    deviceName: string;
    os: string;
    totalTokens: number;
    totalCostUsd: number;
  }>;
}
```

Model and device lists should be limited to the top 5 by token total. Provider lists can include all known providers because the current provider set is small.

## Server Design

Add a server-side query function for member detail data. It should:

1. Resolve the member by `username`.
2. Compute the selected period range using the existing period utilities.
3. Aggregate `DailyProviderUsage` by date for the trend range.
4. Aggregate provider totals from `DailyProviderUsage`.
5. Aggregate top model totals from `DailyModelUsage`.
6. Aggregate top device totals from `DailyProviderUsage` joined to `Device`.
7. Reuse the existing safe bigint conversion guard for token totals.
8. Return `null` or throw a typed not-found result when the member does not exist.

Expose this through a public route:

```text
GET /api/leaderboard/members/[username]?period=daily
```

The route should validate `period` with the shared `periodSchema`, default to `daily`, and return:

- `200` with detail JSON for a known member.
- `404` for an unknown username.
- `400` only for structurally invalid inputs that cannot be normalized by the schema.
- `500` for unexpected server errors without leaking private details.

## Client Design

`LeaderboardTable` should become a client component or delegate row interactivity to a small client wrapper. The design should keep server rendering for the page-level data fetch, while moving only the row selection and dialog fetch state to the client.

Recommended component boundaries:

- `LeaderboardTable`: renders table structure and interactive rows.
- `MemberUsageDialog`: owns selected member, open state, detail fetch, loading, error, and retry.
- `MemberUsageCharts`: renders the chart and breakdown content from already-fetched detail data.
- `MemberUsageDialogSkeleton`: renders stable loading dimensions.

The client fetch should start only when a row is selected. Closing and reopening the same member can reuse cached state in component memory during the current page lifetime, but persistent client caching is not required for the first version.

## Empty and Error States

- Empty leaderboard: keep the existing "No tokens burned yet" state.
- Member with no selected-period usage: show zero totals and an empty chart message inside the dialog.
- Trend with no points: reserve the chart area and show a concise empty state.
- API loading: show a skeleton header and chart area.
- API error: show a compact error message with a retry button.
- Unknown member: show a not-found message if reached from stale client state.

## Accessibility

- Rows must be operable by mouse and keyboard.
- The dialog must include a title and description.
- The close behavior should use the existing shadcn/Radix dialog behavior.
- The primary chart should use Recharts `accessibilityLayer`.
- Chart tooltips are helpful enhancement, not the only way to understand totals; visible summary totals and list breakdowns remain readable without hover.

## Testing

Server tests should cover:

- Leaderboard rows include `username`.
- Ranking behavior remains stable when usernames are added.
- Detail queries aggregate trend data by day.
- Detail queries aggregate provider totals.
- Detail queries return top 5 models and devices.
- All-time detail uses all-time summary/breakdowns and a bounded trend range.
- Unknown usernames return 404 through the route.
- Unsafe bigint totals still throw via the existing guard.

Component tests should cover:

- A member row opens the dialog.
- The dialog fetches the selected `username` and current period.
- Loading, error, empty, and success states render correctly.
- The bar chart receives daily trend data in date order.

Playwright should cover:

- The public leaderboard renders.
- Clicking a member row opens the public detail dialog.
- The dialog shows member identity, total tokens, and a usage trend region.

## Implementation Notes

- Prefer structured Prisma aggregates and typed mapping over ad hoc string manipulation.
- Use existing formatting helpers such as `formatTokens` and `formatUsd`.
- Add shared schemas/types for the new public detail response if tests or route validation benefit from them.
- Avoid a large refactor of the leaderboard page; keep the change scoped to the data needed for row selection and charts.
- Do not introduce custom chart CSS outside the shadcn chart component and existing global CSS variable conventions.
