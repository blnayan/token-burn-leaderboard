# Member Usage Dialog Ranges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make member usage dialogs fetch and display usage for Past 7 days or Past 30 days independently of the leaderboard filter, with blue shadcn chart bars.

**Architecture:** Add a shared `MemberUsageRange` schema for `7d` and `30d`, then let the member usage server function accept either the existing leaderboard period or the new dialog range. The dialog owns the selected range locally, fetches with `range=7d|30d`, and renders a two-option shadcn Tabs control above the chart.

**Tech Stack:** Next.js App Router, React client components, Vitest, Testing Library, Prisma, zod, shadcn/ui Tabs and Chart, Recharts, Tailwind CSS v4 variables.

---

## File Structure

- Modify `packages/shared/src/schemas.ts` to add `memberUsageRangeSchema`, `MemberUsageRange`, and allow member usage details to identify `7d`/`30d` responses.
- Modify `packages/shared/src/schemas.test.ts` to cover valid and invalid dialog ranges.
- Modify `apps/web/src/server/leaderboard.ts` so `getMemberUsageDetail` accepts `LeaderboardPeriod | MemberUsageRange` and zero-fills trailing 7-day/30-day range windows.
- Modify `apps/web/src/server/leaderboard.test.ts` to verify the trailing range date filters and zero-filled trend behavior.
- Modify `apps/web/src/app/api/leaderboard/members/[username]/route.ts` to accept strict `range=7d|30d` while preserving legacy `period` behavior.
- Modify `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts` to cover `range`, bad `range`, and legacy period behavior.
- Modify `apps/web/src/components/member-usage-dialog.tsx` so the dialog owns its range state and renders shadcn Tabs for Past 7 days / Past 30 days.
- Modify `apps/web/src/components/member-usage-dialog.test.tsx` to verify default `range=7d`, selecting Past 30 days, and removal of leaderboard period dependency.
- Modify `apps/web/src/components/leaderboard-table.tsx` and `apps/web/src/components/leaderboard-table.test.tsx` to stop passing leaderboard period into the dialog.
- Modify `apps/web/src/components/member-usage-charts.tsx` to use shadcn ChartConfig theme colors with Tailwind blue CSS variables.

### Task 1: Shared Range Schema

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Add `memberUsageRangeSchema` to the imports in `packages/shared/src/schemas.test.ts`, then add this test near the period schema tests:

```ts
describe("memberUsageRangeSchema", () => {
  it("accepts dialog usage ranges", () => {
    expect(memberUsageRangeSchema.parse("7d")).toBe("7d");
    expect(memberUsageRangeSchema.parse("30d")).toBe("30d");
  });

  it("rejects unsupported dialog usage ranges", () => {
    expect(() => memberUsageRangeSchema.parse("daily")).toThrow();
    expect(() => memberUsageRangeSchema.parse("all-time")).toThrow();
  });
});
```

Update the member usage detail test payload and expectation to use a range:

```ts
const parsed = memberUsageDetailSchema.parse({
  member: { username: "ada", displayName: "Ada" },
  period: "7d",
  summary: { rank: 1, totalTokens: 300, totalCostUsd: 3.5 },
  trend: [{ date: "2026-06-01", totalTokens: 100, totalCostUsd: 1.25 }],
  providers: [{ provider: "codex", totalTokens: 100, totalCostUsd: 1.25 }],
  models: [{ modelName: "gpt-5-codex", provider: "codex", totalTokens: 80, totalCostUsd: 1 }],
  devices: [{ deviceName: "Ada MacBook", os: "darwin", totalTokens: 100, totalCostUsd: 1.25 }],
});

expect(parsed.period).toBe("7d");
```

- [ ] **Step 2: Run the failing shared tests**

Run: `pnpm --dir packages/shared test -- schemas.test.ts`

Expected: FAIL because `memberUsageRangeSchema` is not exported and `"7d"` is not accepted in `memberUsageDetailSchema.period`.

- [ ] **Step 3: Implement the shared schema**

In `packages/shared/src/schemas.ts`, add:

```ts
export const memberUsageRangeSchema = z.enum(["7d", "30d"]);
export type MemberUsageRange = z.infer<typeof memberUsageRangeSchema>;

export const memberUsageDetailPeriodSchema = z.union([periodSchema, memberUsageRangeSchema]);
export type MemberUsageDetailPeriod = z.infer<typeof memberUsageDetailPeriodSchema>;
```

Then change the detail schema field:

```ts
period: memberUsageDetailPeriodSchema,
```

- [ ] **Step 4: Run shared tests**

Run: `pnpm --dir packages/shared test -- schemas.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat: add member usage range schema"
```

### Task 2: Server Range Aggregation

**Files:**
- Modify: `apps/web/src/server/leaderboard.ts`
- Modify: `apps/web/src/server/leaderboard.test.ts`

- [ ] **Step 1: Write the failing server test**

Add a test in `describe("getMemberUsageDetail", ...)` that calls:

```ts
const detail = await getMemberUsageDetail(
  "ada",
  "7d",
  new Date("2026-06-07T12:00:00.000Z"),
);
```

Use mocked rows for only `2026-06-07`, then assert:

```ts
expect(detail?.period).toBe("7d");
expect(detail?.trend).toHaveLength(7);
expect(detail?.trend[0]).toEqual({
  date: "2026-06-01",
  totalTokens: 0,
  totalCostUsd: 0,
});
expect(detail?.trend.at(-1)).toEqual({
  date: "2026-06-07",
  totalTokens: 70,
  totalCostUsd: 0.7,
});
expect(prismaMock.dailyProviderUsage.aggregate).toHaveBeenCalledWith({
  _sum: { totalTokens: true, costUsd: true },
  where: {
    memberId: "member-1",
    date: {
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lt: new Date("2026-06-08T00:00:00.000Z"),
    },
  },
});
```

- [ ] **Step 2: Run the failing server test**

Run: `pnpm --dir apps/web test -- src/server/leaderboard.test.ts`

Expected: FAIL because `"7d"` is not assignable to the current `LeaderboardPeriod` function parameter.

- [ ] **Step 3: Implement range aggregation**

In `apps/web/src/server/leaderboard.ts`, import `type MemberUsageRange` and change the function parameter to:

```ts
export type MemberUsageRequestPeriod = LeaderboardPeriod | MemberUsageRange;
```

Update `getMemberUsageDetail` to accept `period: MemberUsageRequestPeriod`.

Add helpers:

```ts
function isMemberUsageRange(period: MemberUsageRequestPeriod): period is MemberUsageRange {
  return period === "7d" || period === "30d";
}

function getMemberUsageRangeDays(range: MemberUsageRange): number {
  return range === "7d" ? 7 : 30;
}
```

Replace the summary/trend filter setup with:

```ts
const rangeDates = isMemberUsageRange(period)
  ? getRecentUtcDateWindow(getMemberUsageRangeDays(period), now)
  : null;
const summaryDateFilter = rangeDates
  ? dateWindowFilter(rangeDates[0] as string, rangeDates[rangeDates.length - 1] as string)
  : getPeriodDateFilter(period, now);
const summaryWhere = usageWhere(member.id, summaryDateFilter);
const trendDates =
  rangeDates ?? (period === "all-time" ? getRecentUtcDateWindow(30, now) : null);
```

- [ ] **Step 4: Run server tests**

Run: `pnpm --dir apps/web test -- src/server/leaderboard.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/leaderboard.ts apps/web/src/server/leaderboard.test.ts
git commit -m "feat: support member usage date ranges"
```

### Task 3: API Range Parameter

**Files:**
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.ts`
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Add a route test for the new range parameter:

```ts
it("passes dialog usage ranges to the member usage detail loader", async () => {
  getMemberUsageDetailMock.mockResolvedValue({
    member: { username: "ada", displayName: "Ada" },
    period: "30d",
    summary: { rank: null, totalTokens: 100, totalCostUsd: 1.25 },
    trend: [],
    providers: [],
    models: [],
    devices: [],
  });

  const response = await GET(
    new NextRequest("https://token-burn.test/api/leaderboard/members/ada?range=30d"),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(response.status).toBe(200);
  expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "30d");
  await expect(response.json()).resolves.toMatchObject({ period: "30d" });
});
```

Add a strict invalid range test:

```ts
it("rejects invalid dialog usage ranges", async () => {
  const response = await GET(
    new NextRequest("https://token-burn.test/api/leaderboard/members/ada?range=daily"),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(response.status).toBe(400);
  expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toEqual({ error: "Invalid usage range" });
});
```

- [ ] **Step 2: Run the failing route tests**

Run: `pnpm --dir apps/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts'`

Expected: FAIL because the route ignores `range`.

- [ ] **Step 3: Implement route parsing**

In `route.ts`, import `memberUsageRangeSchema` and parse the query like this:

```ts
const rangeParam = request.nextUrl.searchParams.get("range");
const parsedRange = rangeParam ? memberUsageRangeSchema.safeParse(rangeParam) : null;

if (parsedRange && !parsedRange.success) {
  return NextResponse.json({ error: "Invalid usage range" }, { status: 400 });
}

const period =
  parsedRange?.data ??
  periodSchema.catch("daily").parse(request.nextUrl.searchParams.get("period") ?? undefined);
```

- [ ] **Step 4: Run route tests**

Run: `pnpm --dir apps/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/src/app/api/leaderboard/members/[username]/route.ts' 'apps/web/src/app/api/leaderboard/members/[username]/route.test.ts'
git commit -m "feat: add member usage range api"
```

### Task 4: Dialog Range UI

**Files:**
- Modify: `apps/web/src/components/member-usage-dialog.tsx`
- Modify: `apps/web/src/components/member-usage-dialog.test.tsx`
- Modify: `apps/web/src/components/leaderboard-table.tsx`
- Modify: `apps/web/src/components/leaderboard-table.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Update the dialog render calls to remove `period`.

Update the default fetch assertion:

```ts
expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/members/ada?range=7d");
expect(screen.getByRole("tab", { name: "Past 7 days" }).getAttribute("data-state")).toBe("active");
```

Add a selection test:

```ts
it("lets the dialog switch from Past 7 days to Past 30 days", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...detail, period: "30d" }),
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemberUsageDialog
      member={{ username: "ada", displayName: "Ada", rank: 1 }}
      open
      onOpenChange={() => {}}
    />,
  );

  await screen.findByRole("heading", { name: "Ada" });
  await user.click(screen.getByRole("tab", { name: "Past 30 days" }));

  expect(fetchMock).toHaveBeenLastCalledWith("/api/leaderboard/members/ada?range=30d");
});
```

Update `leaderboard-table.test.tsx` mock props to remove `period`, and remove the `data-period` assertion.

- [ ] **Step 2: Run failing component tests**

Run: `pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx src/components/leaderboard-table.test.tsx`

Expected: FAIL because the components still pass/use leaderboard period.

- [ ] **Step 3: Implement local dialog range state**

In `member-usage-dialog.tsx`, remove `LeaderboardPeriod`, add `MemberUsageRange`, and import shadcn Tabs:

```ts
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
```

Add:

```ts
const usageRanges: { label: string; value: MemberUsageRange }[] = [
  { label: "Past 7 days", value: "7d" },
  { label: "Past 30 days", value: "30d" },
];
```

Remove the `period` prop. Track state by member username:

```ts
const [rangeState, setRangeState] = React.useState<{ username: string; range: MemberUsageRange }>({
  username: "",
  range: "7d",
});
const selectedRange = member && rangeState.username === member.username ? rangeState.range : "7d";
```

Fetch with:

```ts
`/api/leaderboard/members/${encodeURIComponent(username)}?range=${selectedRange}`
```

Render the control above the summary:

```tsx
<Tabs
  value={selectedRange}
  onValueChange={(value) => {
    if (!member || (value !== "7d" && value !== "30d")) return;
    setRangeState({ username: member.username, range: value });
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
```

Change the description to `Usage details for the selected range.` and the rank card label to `Leaderboard Rank`.

In `leaderboard-table.tsx`, render:

```tsx
<MemberUsageDialog
  member={selectedMember}
  open={selectedMember !== null}
  onOpenChange={(open) => {
    if (!open) setSelectedMember(null);
  }}
/>
```

- [ ] **Step 4: Run component tests**

Run: `pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx src/components/leaderboard-table.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/member-usage-dialog.tsx apps/web/src/components/member-usage-dialog.test.tsx apps/web/src/components/leaderboard-table.tsx apps/web/src/components/leaderboard-table.test.tsx
git commit -m "feat: add member usage range selector"
```

### Task 5: Blue Chart Theme

**Files:**
- Modify: `apps/web/src/components/member-usage-charts.tsx`

- [ ] **Step 1: Update chart config**

Change:

```ts
color: "var(--chart-1)",
```

to:

```ts
theme: {
  light: "var(--color-blue-500)",
  dark: "var(--color-blue-400)",
},
```

Keep:

```tsx
<Bar dataKey="totalTokens" fill="var(--color-totalTokens)" radius={4} />
```

This follows the shadcn chart pattern where `ChartContainer` converts the config into `--color-totalTokens`, and Recharts consumes that variable.

- [ ] **Step 2: Run a focused typecheck**

Run: `pnpm --dir apps/web typecheck`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/member-usage-charts.tsx
git commit -m "fix: use blue member usage chart bars"
```

### Task 6: Full Verification

**Files:**
- No source files expected.

- [ ] **Step 1: Run shared tests**

Run: `pnpm --dir packages/shared test`

Expected: PASS.

- [ ] **Step 2: Run web tests**

Run: `pnpm --dir apps/web test`

Expected: PASS.

- [ ] **Step 3: Run web lint**

Run: `pnpm --dir apps/web lint`

Expected: exit code 0. A pre-existing `postJson` warning in `apps/web/scripts/sync-e2e.mjs` may still appear.

- [ ] **Step 4: Run web typecheck**

Run: `pnpm --dir apps/web typecheck`

Expected: PASS.

- [ ] **Step 5: Run web build**

Run with the project’s required build environment variables, matching the existing deployment workflow:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
DATABASE_URL=postgresql://tokenburn:tokenburn@127.0.0.1:5432/tokenburn \
SESSION_SECRET=test-session-secret \
SYNC_API_SECRET=test-sync-secret \
pnpm --dir apps/web build
```

Expected: PASS.

- [ ] **Step 6: Commit plan checklist updates if any**

If the plan file was checked off during execution, commit the checked boxes:

```bash
git add docs/superpowers/plans/2026-06-07-member-usage-dialog-ranges.md
git commit -m "docs: complete member usage dialog ranges plan"
```
