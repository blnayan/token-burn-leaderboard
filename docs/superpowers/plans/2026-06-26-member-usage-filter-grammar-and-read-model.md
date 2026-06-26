# Member Usage Filter Grammar and Read Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Member usage filters one shared grammar and deepen the Member usage read model without changing the public route response shape.

**Architecture:** `apps/web/src/server/member-usage-query.ts` becomes the shared grammar module for parsing, encoding, model keys, defaults, and filter toggles. `apps/web/src/server/leaderboard.ts` keeps exporting `getMemberUsageDetail(username, query, now)` and gains named read-model helpers for period planning, query planning, aggregate mapping, trend filling, and model-cost allocation. The route remains a thin HTTP adapter.

**Tech Stack:** TypeScript, Next.js route handlers, React client components, Prisma Client mocks, Vitest, Testing Library, `@token-burn/shared` schemas.

---

## File Structure

- Modify `apps/web/src/server/member-usage-query.ts`
  - Owns `MemberUsageQuery` parsing and adds query encoding, model-key helpers, filter equality, filter toggles, and active-filter detection.
- Modify `apps/web/src/server/member-usage-query.test.ts`
  - Covers grammar parsing, encoding, toggle invariants, model-key splitting, and stable validation errors.
- Modify `apps/web/src/components/member-usage-dialog.tsx`
  - Removes local URL grammar and local filter toggle rules. Uses shared grammar helpers.
- Modify `apps/web/src/components/member-usage-charts.tsx`
  - Imports filter types and model-key/equality helpers from the grammar module. Keeps chart rendering local.
- Modify `apps/web/src/components/member-usage-dialog.test.tsx`
  - Keeps user-visible fetch and toggle behavior coverage after the dialog moves onto grammar helpers.
- Modify `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`
  - Keeps thin route tests for success, invalid-query `400`, and missing-member `404`. Detailed grammar cases stay in `member-usage-query.test.ts`.
- Modify `apps/web/src/server/leaderboard.ts`
  - Keeps `getMemberUsageDetail` as the public read-model entry point. Extracts named internal helpers inside this file.
- Modify `apps/web/src/server/leaderboard.test.ts`
  - Keeps behavioral coverage for summary, trend, provider/model/device breakdowns, filters, model-cost fallback, date windows, and unknown members. Reduces exact call-order coupling where result assertions already prove behavior.

## Task 1: Add Shared Member Usage Grammar Helpers

**Files:**
- Modify: `apps/web/src/server/member-usage-query.test.ts`
- Modify: `apps/web/src/server/member-usage-query.ts`

- [ ] **Step 1: Add failing grammar tests**

Add these imports in `apps/web/src/server/member-usage-query.test.ts`:

```ts
import {
  encodeMemberUsageModelFilter,
  encodeMemberUsageQuery,
  hasMemberUsageFilters,
  isSameMemberUsageModelFilter,
  MemberUsageQueryError,
  parseMemberUsageQuery,
  toggleMemberUsageDeviceFilter,
  toggleMemberUsageModelFilter,
  toggleMemberUsageProviderFilter,
} from "./member-usage-query";
```

Add these tests after the existing parse tests:

```ts
describe("encodeMemberUsageQuery", () => {
  it("encodes ranges, providers, models, and devices with the route grammar", () => {
    const providerParams = encodeMemberUsageQuery({
      period: "7d",
      filters: {
        providers: ["codex", "claude_code"],
        models: [],
        devices: ["device-1"],
      },
    });

    expect(providerParams.toString()).toBe(
      "range=7d&provider=codex&provider=claude_code&device=device-1",
    );

    const modelParams = encodeMemberUsageQuery({
      period: "30d",
      filters: {
        providers: [],
        models: [
          { provider: "codex", modelName: "gpt-5" },
          { provider: "claude_code", modelName: "opus:sonnet" },
        ],
        devices: ["device-2"],
      },
    });

    expect(modelParams.toString()).toBe(
      "range=30d&model=codex%3Agpt-5&model=claude_code%3Aopus%3Asonnet&device=device-2",
    );
  });

  it("encodes non-range periods with the period param", () => {
    expect(
      encodeMemberUsageQuery({
        period: "weekly",
        filters: { providers: [], models: [], devices: [] },
      }).toString(),
    ).toBe("period=weekly");
  });

  it("uses the same model key grammar for encoding and parsing", () => {
    const key = encodeMemberUsageModelFilter({
      provider: "codex",
      modelName: "model:with:colon",
    });

    expect(key).toBe("codex:model:with:colon");
    expect(parseMemberUsageQuery(new URLSearchParams([["model", key]]))).toEqual({
      period: "daily",
      filters: {
        providers: [],
        models: [{ provider: "codex", modelName: "model:with:colon" }],
        devices: [],
      },
    });
  });
});

describe("member usage filter helpers", () => {
  it("toggles provider, model, and device filters using one invariant set", () => {
    const withModel = toggleMemberUsageModelFilter(
      { providers: ["codex"], models: [], devices: ["device-1"] },
      { provider: "claude_code", modelName: "opus" },
    );

    expect(withModel).toEqual({
      providers: [],
      models: [{ provider: "claude_code", modelName: "opus" }],
      devices: ["device-1"],
    });

    const withoutModel = toggleMemberUsageModelFilter(withModel, {
      provider: "claude_code",
      modelName: "opus",
    });
    expect(withoutModel).toEqual({
      providers: [],
      models: [],
      devices: ["device-1"],
    });

    const withProvider = toggleMemberUsageProviderFilter(
      { providers: [], models: [{ provider: "claude_code", modelName: "opus" }], devices: ["device-1"] },
      "codex",
    );
    expect(withProvider).toEqual({
      providers: ["codex"],
      models: [],
      devices: ["device-1"],
    });

    const withSecondDevice = toggleMemberUsageDeviceFilter(withProvider, "device-2");
    expect(withSecondDevice).toEqual({
      providers: ["codex"],
      models: [],
      devices: ["device-1", "device-2"],
    });

    expect(toggleMemberUsageDeviceFilter(withSecondDevice, "device-1")).toEqual({
      providers: ["codex"],
      models: [],
      devices: ["device-2"],
    });
  });

  it("detects active filters and compares model filters", () => {
    expect(hasMemberUsageFilters({ providers: [], models: [], devices: [] })).toBe(false);
    expect(hasMemberUsageFilters({ providers: [], models: [], devices: ["device-1"] })).toBe(true);
    expect(
      isSameMemberUsageModelFilter(
        { provider: "codex", modelName: "gpt-5" },
        { provider: "codex", modelName: "gpt-5" },
      ),
    ).toBe(true);
    expect(
      isSameMemberUsageModelFilter(
        { provider: "codex", modelName: "gpt-5" },
        { provider: "codex", modelName: "gpt-4" },
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the grammar tests and verify the expected failure**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/member-usage-query.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement the grammar helpers**

In `apps/web/src/server/member-usage-query.ts`, add these exports above `parseMemberUsageQuery`:

```ts
export function encodeMemberUsageQuery(query: MemberUsageQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (isMemberUsageRange(query.period)) {
    params.set("range", query.period);
  } else {
    params.set("period", query.period);
  }

  for (const provider of query.filters.providers) {
    params.append("provider", provider);
  }

  for (const model of query.filters.models) {
    params.append("model", encodeMemberUsageModelFilter(model));
  }

  for (const device of query.filters.devices) {
    params.append("device", device);
  }

  return params;
}

export function encodeMemberUsageModelFilter(model: MemberUsageModelFilter): string {
  return `${model.provider}:${model.modelName}`;
}

export function isSameMemberUsageModelFilter(
  left: MemberUsageModelFilter,
  right: MemberUsageModelFilter,
): boolean {
  return left.provider === right.provider && left.modelName === right.modelName;
}

export function hasMemberUsageFilters(filters: MemberUsageFilters): boolean {
  return filters.providers.length > 0 || filters.models.length > 0 || filters.devices.length > 0;
}

export function toggleMemberUsageProviderFilter(
  filters: MemberUsageFilters,
  provider: MemberUsageFilters["providers"][number],
): MemberUsageFilters {
  const selected = filters.providers.includes(provider);

  return {
    providers: selected
      ? filters.providers.filter((selectedProvider) => selectedProvider !== provider)
      : [...filters.providers, provider],
    models: [],
    devices: [...filters.devices],
  };
}

export function toggleMemberUsageModelFilter(
  filters: MemberUsageFilters,
  model: MemberUsageModelFilter,
): MemberUsageFilters {
  const selected = filters.models.some((selectedModel) =>
    isSameMemberUsageModelFilter(selectedModel, model),
  );

  return {
    providers: [],
    models: selected
      ? filters.models.filter((selectedModel) => !isSameMemberUsageModelFilter(selectedModel, model))
      : [...filters.models, model],
    devices: [...filters.devices],
  };
}

export function toggleMemberUsageDeviceFilter(
  filters: MemberUsageFilters,
  deviceId: string,
): MemberUsageFilters {
  const selected = filters.devices.includes(deviceId);

  return {
    providers: [...filters.providers],
    models: [...filters.models],
    devices: selected
      ? filters.devices.filter((selectedDeviceId) => selectedDeviceId !== deviceId)
      : [...filters.devices, deviceId],
  };
}

function isMemberUsageRange(period: MemberUsageRequestPeriod): period is MemberUsageRange {
  return period === "7d" || period === "30d";
}

function parseMemberUsageModelFilter(modelParam: string): MemberUsageModelFilter {
  const separatorIndex = modelParam.indexOf(":");
  if (separatorIndex <= 0) {
    throw new MemberUsageQueryError("Invalid model filter");
  }

  const providerPart = modelParam.slice(0, separatorIndex).trim();
  const modelName = modelParam.slice(separatorIndex + 1).trim();
  const parsedProvider = providerSchema.safeParse(providerPart);
  if (!parsedProvider.success || modelName.length === 0) {
    throw new MemberUsageQueryError("Invalid model filter");
  }

  return { provider: parsedProvider.data, modelName };
}
```

Replace the model parsing loop inside `parseMemberUsageQuery` with:

```ts
const modelFilters = searchParams
  .getAll("model")
  .map((modelParam) => parseMemberUsageModelFilter(modelParam));
```

- [ ] **Step 4: Run the grammar tests and verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/member-usage-query.test.ts
```

Expected: PASS for all tests in `member-usage-query.test.ts`.

- [ ] **Step 5: Commit the grammar helper change**

Run:

```bash
git add apps/web/src/server/member-usage-query.ts apps/web/src/server/member-usage-query.test.ts
git commit -m "refactor: share member usage filter grammar"
```

## Task 2: Move Dialog and Chart Filter Logic Onto the Grammar Module

**Files:**
- Modify: `apps/web/src/components/member-usage-dialog.tsx`
- Modify: `apps/web/src/components/member-usage-charts.tsx`
- Test: `apps/web/src/components/member-usage-dialog.test.tsx`
- Test: `apps/web/src/components/member-usage-charts.test.tsx`

- [ ] **Step 1: Run existing component tests as characterization coverage**

Run:

```bash
pnpm --filter @token-burn/web test -- src/components/member-usage-dialog.test.tsx src/components/member-usage-charts.test.tsx
```

Expected: PASS before refactoring.

- [ ] **Step 2: Update the dialog imports**

In `apps/web/src/components/member-usage-dialog.tsx`, remove `MemberUsageSelectedFilters` and `MemberUsageModelFilter` from the chart import. Add this import from the grammar module:

```ts
import {
  encodeMemberUsageQuery,
  emptyMemberUsageFilters,
  toggleMemberUsageDeviceFilter,
  toggleMemberUsageModelFilter,
  toggleMemberUsageProviderFilter,
  type MemberUsageFilters,
  type MemberUsageModelFilter,
} from "@/server/member-usage-query";
```

Change local state types from `MemberUsageSelectedFilters` to `MemberUsageFilters`. Remove the local `emptySelectedFilters` constant.

- [ ] **Step 3: Replace local dialog toggles with grammar helpers**

Replace the three toggle callbacks with:

```ts
const toggleProvider = React.useCallback(
  (provider: MemberUsageDetail["providers"][number]["provider"]) => {
    updateFilters((filters) => toggleMemberUsageProviderFilter(filters, provider));
  },
  [updateFilters],
);

const toggleModel = React.useCallback(
  (model: MemberUsageModelFilter) => {
    updateFilters((filters) => toggleMemberUsageModelFilter(filters, model));
  },
  [updateFilters],
);

const toggleDevice = React.useCallback(
  (deviceId: MemberUsageDetail["devices"][number]["deviceId"]) => {
    updateFilters((filters) => toggleMemberUsageDeviceFilter(filters, deviceId));
  },
  [updateFilters],
);
```

Replace uses of `emptySelectedFilters` with `emptyMemberUsageFilters`.

- [ ] **Step 4: Replace local URL construction with grammar encoding**

Replace the body of `buildMemberUsageUrl` with:

```ts
const params = encodeMemberUsageQuery({ period: range, filters });
return `/api/leaderboard/members/${encodeURIComponent(username)}?${params.toString()}`;
```

Remove the local `isSameModelFilter` function from the dialog file.

- [ ] **Step 5: Update chart imports and model-key usage**

In `apps/web/src/components/member-usage-charts.tsx`, remove local type definitions for `MemberUsageProviderFilter`, `MemberUsageModelFilter`, and `MemberUsageSelectedFilters`. Import shared equivalents and helpers:

```ts
import {
  encodeMemberUsageModelFilter,
  hasMemberUsageFilters,
  isSameMemberUsageModelFilter,
  type MemberUsageFilters,
  type MemberUsageModelFilter,
} from "@/server/member-usage-query";
```

Keep this chart-local alias so prop names do not churn:

```ts
type MemberUsageSelectedFilters = MemberUsageFilters;
type MemberUsageProviderFilter = MemberUsageFilters["providers"][number];
```

Change the model breakdown key from:

```ts
key: `${item.provider}:${item.modelName}`,
```

to:

```ts
key: encodeMemberUsageModelFilter(item),
```

Change model selected comparison from `isSameModelFilter` to `isSameMemberUsageModelFilter`. Remove local `hasSelectedFilters` and `isSameModelFilter`.

Change the active-filter check from:

```ts
const hasActiveFilters = hasSelectedFilters(selectedFilters);
```

to:

```ts
const hasActiveFilters = hasMemberUsageFilters(selectedFilters);
```

- [ ] **Step 6: Run component tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/components/member-usage-dialog.test.tsx src/components/member-usage-charts.test.tsx
```

Expected: PASS with the same user-visible fetch URLs and chart behavior.

- [ ] **Step 7: Run focused typecheck for the web package**

Run:

```bash
pnpm --filter @token-burn/web typecheck
```

Expected: PASS. If the client import from `@/server/member-usage-query` exposes an accidental server-only dependency, move the grammar module to `apps/web/src/lib/member-usage-query.ts` and update imports in the route, dialog, charts, and tests to use `@/lib/member-usage-query`.

- [ ] **Step 8: Commit the client grammar wiring**

Run:

```bash
git add apps/web/src/components/member-usage-dialog.tsx apps/web/src/components/member-usage-charts.tsx
git commit -m "refactor: use shared member usage grammar in charts"
```

## Task 3: Keep Route Tests Thin

**Files:**
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`
- Test: `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`

- [ ] **Step 1: Replace route grammar-detail tests with thin HTTP boundary tests**

Keep these route test cases:

```ts
it("returns public member usage detail", async () => {
  getMemberUsageDetailMock.mockResolvedValue({
    member: { username: "ada", displayName: "Ada" },
    period: "weekly",
    summary: { rank: null, totalTokens: 100, totalCostUsd: 1.25 },
    trend: [],
    providers: [],
    models: [],
    devices: [],
  });

  const response = await GET(
    new NextRequest("https://token-burn.test/api/leaderboard/members/ada?period=weekly"),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(response.status).toBe(200);
  expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
    "ada",
    {
      period: "weekly",
      filters: { providers: [], models: [], devices: [] },
    },
    expect.any(Date),
  );
  await expect(response.json()).resolves.toMatchObject({
    member: { username: "ada" },
    period: "weekly",
  });
});

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
  expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
    "ada",
    {
      period: "30d",
      filters: { providers: [], models: [], devices: [] },
    },
    expect.any(Date),
  );
});

it("returns 400 for invalid member usage queries", async () => {
  const response = await GET(
    new NextRequest("https://token-burn.test/api/leaderboard/members/ada?range=daily"),
    { params: Promise.resolve({ username: "ada" }) },
  );

  expect(response.status).toBe(400);
  expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
  await expect(response.json()).resolves.toEqual({ error: "Invalid usage range" });
});

it("returns 404 when the member is missing", async () => {
  getMemberUsageDetailMock.mockResolvedValue(null);

  const response = await GET(
    new NextRequest("https://token-burn.test/api/leaderboard/members/missing"),
    { params: Promise.resolve({ username: "missing" }) },
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: "Member not found" });
});
```

Remove route tests that duplicate detailed provider, model, device, invalid provider, invalid model, blank device, and provider/model-combination grammar cases. Those cases are covered in `apps/web/src/server/member-usage-query.test.ts`.

- [ ] **Step 2: Run route and grammar tests**

Run:

```bash
pnpm --filter @token-burn/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts' src/server/member-usage-query.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the route test narrowing**

Run:

```bash
git add 'apps/web/src/app/api/leaderboard/members/[username]/route.test.ts'
git commit -m "test: keep member usage route tests thin"
```

## Task 4: Reduce Read Model Test Call-Order Coupling

**Files:**
- Modify: `apps/web/src/server/leaderboard.test.ts`
- Test: `apps/web/src/server/leaderboard.test.ts`

- [ ] **Step 1: Add query-shape mock helpers to the test file**

Add these helpers above `describe("getMemberUsageDetail", () => {`:

```ts
type GroupByArgs = { by: string[]; where?: unknown; orderBy?: unknown };

function whereHasProviderFilter(where: unknown): boolean {
  return typeof where === "object" && where !== null && "provider" in where;
}

function mockProviderGroupByByShape(rows: {
  trend?: unknown[];
  providers?: unknown[];
  providerCosts?: unknown[];
  providerTrendCosts?: unknown[];
  devices?: unknown[];
}) {
  prismaMock.dailyProviderUsage.groupBy.mockImplementation(async (args: GroupByArgs) => {
    if (args.by.length === 1 && args.by[0] === "date") return rows.trend ?? [];
    if (args.by.length === 1 && args.by[0] === "provider") {
      return whereHasProviderFilter(args.where) ? (rows.providerCosts ?? []) : (rows.providers ?? []);
    }
    if (args.by.length === 2 && args.by.includes("date") && args.by.includes("provider")) {
      return rows.providerTrendCosts ?? [];
    }
    if (args.by.length === 1 && args.by[0] === "deviceId") return rows.devices ?? [];
    return [];
  });
}

function mockModelGroupByByShape(rows: {
  summary?: unknown[];
  trend?: unknown[];
  breakdown?: unknown[];
}) {
  prismaMock.dailyModelUsage.groupBy.mockImplementation(async (args: GroupByArgs) => {
    if (args.by.includes("date")) return rows.trend ?? [];
    if (args.orderBy) return rows.breakdown ?? [];
    return rows.summary ?? [];
  });
}
```

- [ ] **Step 2: Convert tests that use chained `mockResolvedValueOnce` where behavior is enough**

For provider-summary tests, replace chained provider `groupBy` setup with `mockProviderGroupByByShape`. Example replacement for the weekly test:

```ts
mockProviderGroupByByShape({
  trend: [
    {
      date: new Date("2026-06-01T00:00:00.000Z"),
      _sum: { totalTokens: 100n, costUsd: 1.25 },
    },
    {
      date: new Date("2026-06-02T00:00:00.000Z"),
      _sum: { totalTokens: 200n, costUsd: 2.5 },
    },
  ],
  providers: [{ provider: "codex", _sum: { totalTokens: 300n, costUsd: 3.75 } }],
  devices: [{ deviceId: "device-1", _sum: { totalTokens: 300n, costUsd: 3.75 } }],
});

mockModelGroupByByShape({
  breakdown: [
    {
      provider: "codex",
      modelName: "gpt-5-codex",
      _sum: { totalTokens: 250n, costUsd: 3 },
    },
  ],
});
```

For model-filter tests, use `mockModelGroupByByShape` for summary, trend, and breakdown rows, and use `mockProviderGroupByByShape` for provider costs, provider trend costs, provider breakdowns, and devices.

- [ ] **Step 3: Replace exact order assertions with boundary assertions where result assertions already prove behavior**

Keep exact query-shape assertions only for date-window and filter behavior. Use order-insensitive assertions:

```ts
expect(prismaMock.dailyProviderUsage.aggregate).toHaveBeenCalledWith({
  _sum: { totalTokens: true, costUsd: true },
  where: { memberId: "member-1", date: weeklyDateFilter },
});

expect(prismaMock.dailyProviderUsage.groupBy).toHaveBeenCalledWith(
  expect.objectContaining({
    by: ["date"],
    where: { memberId: "member-1", date: weeklyDateFilter },
  }),
);

expect(prismaMock.dailyModelUsage.groupBy).toHaveBeenCalledWith(
  expect.objectContaining({
    by: ["provider", "modelName"],
    where: { memberId: "member-1", date: weeklyDateFilter },
  }),
);
```

For the provider/device filter test, keep this query assertion:

```ts
expect(prismaMock.dailyProviderUsage.aggregate).toHaveBeenCalledWith({
  _sum: { totalTokens: true, costUsd: true },
  where: {
    memberId: "member-1",
    date: {
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lt: new Date("2026-06-08T00:00:00.000Z"),
    },
    provider: { in: ["codex"] },
    deviceId: { in: ["device-1"] },
  },
});
```

For the model/device filter test, keep this order-insensitive query assertion:

```ts
expect(prismaMock.dailyModelUsage.groupBy).toHaveBeenCalledWith(
  expect.objectContaining({
    by: ["provider", "modelName"],
    where: {
      memberId: "member-1",
      date: {
        gte: new Date("2026-05-09T00:00:00.000Z"),
        lt: new Date("2026-06-08T00:00:00.000Z"),
      },
      deviceId: { in: ["device-1"] },
      OR: [{ provider: "codex", modelName: "gpt-5-codex" }],
    },
  }),
);
```

- [ ] **Step 4: Run read-model tests before changing production code**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/leaderboard.test.ts
```

Expected: PASS. This proves the test refactor preserved current behavior before production refactoring.

- [ ] **Step 5: Commit the read-model test hardening**

Run:

```bash
git add apps/web/src/server/leaderboard.test.ts
git commit -m "test: reduce member usage read model call-order coupling"
```

## Task 5: Deepen the Member Usage Read Model Internals

**Files:**
- Modify: `apps/web/src/server/leaderboard.ts`
- Test: `apps/web/src/server/leaderboard.test.ts`

- [ ] **Step 1: Run read-model characterization tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/leaderboard.test.ts
```

Expected: PASS before refactoring.

- [ ] **Step 2: Add named read-model plan types and period planner**

In `apps/web/src/server/leaderboard.ts`, add these types near the current `DateFilter` and `UsageTotals` types:

```ts
type MemberUsagePeriodPlan = {
  summaryDateFilter: DateFilter | undefined;
  trendDateFilter: DateFilter | undefined;
  trendDates: string[] | null;
};

type MemberUsageQueryPlan = {
  hasModelFilters: boolean;
  summaryWhere: ReturnType<typeof usageWhere>;
  trendWhere: ReturnType<typeof usageWhere>;
  breakdownWhere: ReturnType<typeof usageWhere>;
  providerCostWhere: ReturnType<typeof usageWhere> | null;
  providerTrendCostWhere: ReturnType<typeof usageWhere> | null;
};
```

Add this helper near the existing date helpers:

```ts
function planMemberUsagePeriod(
  period: MemberUsageRequestPeriod,
  now: Date,
): MemberUsagePeriodPlan {
  if (isMemberUsageRange(period)) {
    const trendDates = getRecentUtcDateWindow(getMemberUsageRangeDays(period), now);
    const summaryDateFilter = dateWindowFilter(
      trendDates[0] as string,
      trendDates[trendDates.length - 1] as string,
    );

    return {
      summaryDateFilter,
      trendDateFilter: summaryDateFilter,
      trendDates,
    };
  }

  const summaryDateFilter = getPeriodDateFilter(period, now);
  const trendDates = period === "all-time" ? getRecentUtcDateWindow(30, now) : null;
  const trendDateFilter = trendDates
    ? dateWindowFilter(trendDates[0] as string, trendDates[trendDates.length - 1] as string)
    : summaryDateFilter;

  return {
    summaryDateFilter,
    trendDateFilter,
    trendDates,
  };
}
```

- [ ] **Step 3: Add query planning and mapping helpers**

Add these helpers near `usageWhere` and the existing mapping functions:

```ts
function planMemberUsageQueries(
  memberId: string,
  filters: MemberUsageFilters,
  periodPlan: MemberUsagePeriodPlan,
): MemberUsageQueryPlan {
  const hasModelFilters = filters.models.length > 0;
  const summaryFilters = hasModelFilters
    ? { models: filters.models, devices: filters.devices }
    : { providers: filters.providers, devices: filters.devices };
  const providerCostFilters = hasModelFilters
    ? { providers: uniqueProvidersForModels(filters.models), devices: filters.devices }
    : {};

  return {
    hasModelFilters,
    summaryWhere: usageWhere(memberId, periodPlan.summaryDateFilter, summaryFilters),
    trendWhere: usageWhere(memberId, periodPlan.trendDateFilter, summaryFilters),
    breakdownWhere: usageWhere(memberId, periodPlan.summaryDateFilter),
    providerCostWhere: hasModelFilters
      ? usageWhere(memberId, periodPlan.summaryDateFilter, providerCostFilters)
      : null,
    providerTrendCostWhere: hasModelFilters
      ? usageWhere(memberId, periodPlan.trendDateFilter, providerCostFilters)
      : null,
  };
}

function totalsByProvider(rows: Array<SumRow & { provider: string }>): Map<string, UsageTotals> {
  return new Map(rows.map((row) => [row.provider, sumToTotals(row)]));
}

function totalsByDateProvider(
  rows: Array<SumRow & { date: Date; provider: string }>,
): Map<string, UsageTotals> {
  return new Map(rows.map((row) => [dateProviderKey(row.date, row.provider), sumToTotals(row)]));
}

function mapProviderBreakdownRows(
  rows: Array<SumRow & { provider: string }>,
): MemberUsageDetail["providers"] {
  return rows.flatMap((row) => {
    const provider = parseProvider(row.provider);
    if (!provider) return [];

    return [{ provider, ...sumToTotals(row) }];
  });
}

function mapModelBreakdownRows(
  rows: Array<SumRow & { provider: string; modelName: string }>,
  providerTotalsByProvider: Map<string, UsageTotals>,
): MemberUsageDetail["models"] {
  return rows.flatMap((row) => {
    const provider = parseProvider(row.provider);
    if (!provider) return [];

    return [
      {
        provider,
        modelName: row.modelName,
        ...modelToTotals(row, providerTotalsByProvider),
      },
    ];
  });
}

function mapDeviceBreakdownRows(
  deviceTotals: Array<UsageTotals & { deviceId: string }>,
  devicesById: Map<string, { id: string; name: string; os: string }>,
): MemberUsageDetail["devices"] {
  return deviceTotals.flatMap((row) => {
    const device = devicesById.get(row.deviceId);
    const os = parseOperatingSystem(device?.os);
    if (!device || !os) return [];

    return [{ deviceName: device.name, os, ...row }];
  });
}
```

- [ ] **Step 4: Rewrite `getMemberUsageDetail` orchestration around the helpers**

Inside `getMemberUsageDetail`, replace the inline period planning block with:

```ts
const periodPlan = planMemberUsagePeriod(period, now);
const queryPlan = planMemberUsageQueries(member.id, filters, periodPlan);
```

Replace uses of `hasModelFilters`, `summaryWhere`, `trendWhere`, `breakdownWhere`, `summaryDateFilter`, `trendDateFilter`, and `trendDates` with the fields on `queryPlan` and `periodPlan`.

For the `Promise.all` block, use these expressions:

```ts
queryPlan.hasModelFilters
  ? prisma.dailyModelUsage.groupBy({
      by: ["provider", "modelName"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.summaryWhere,
    })
  : prisma.dailyProviderUsage.aggregate({
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.summaryWhere,
    })
```

```ts
queryPlan.hasModelFilters
  ? prisma.dailyModelUsage.groupBy({
      by: ["date", "provider", "modelName"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.trendWhere,
      orderBy: { date: "asc" },
    })
  : prisma.dailyProviderUsage.groupBy({
      by: ["date"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.trendWhere,
      orderBy: { date: "asc" },
    })
```

For provider cost reads, use `queryPlan.providerCostWhere` and `queryPlan.providerTrendCostWhere`:

```ts
queryPlan.providerCostWhere
  ? prisma.dailyProviderUsage.groupBy({
      by: ["provider"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.providerCostWhere,
      orderBy: { _sum: { totalTokens: "desc" } },
    })
  : Promise.resolve(null)
```

```ts
queryPlan.providerTrendCostWhere
  ? prisma.dailyProviderUsage.groupBy({
      by: ["date", "provider"],
      _sum: { totalTokens: true, costUsd: true },
      where: queryPlan.providerTrendCostWhere,
      orderBy: { date: "asc" },
    })
  : Promise.resolve(null)
```

Replace final response mapping with the named helpers:

```ts
const breakdownProviderTotalsByProvider = totalsByProvider(providerRows);
const summaryProviderTotalsByProvider = totalsByProvider(providerCostRows ?? providerRows);
const providerTrendTotalsByDateProvider = totalsByDateProvider(providerTrendCostRows ?? []);
const deviceTotals = (deviceRows as Array<SumRow & { deviceId: string }>).map((row) => ({
  deviceId: row.deviceId,
  ...sumToTotals(row),
}));
```

Use the helpers in the returned object:

```ts
providers: mapProviderBreakdownRows(providerRows),
models: mapModelBreakdownRows(modelRows, breakdownProviderTotalsByProvider),
devices: mapDeviceBreakdownRows(deviceTotals, devicesById),
```

Keep the returned `member`, `period`, `summary`, and `trend` shapes identical.

- [ ] **Step 5: Run read-model tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/leaderboard.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run route tests to confirm the public route still works with the same read-model entry point**

Run:

```bash
pnpm --filter @token-burn/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 7: Commit the read-model refactor**

Run:

```bash
git add apps/web/src/server/leaderboard.ts apps/web/src/server/leaderboard.test.ts
git commit -m "refactor: deepen member usage read model"
```

## Task 6: Final Verification

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run focused Member usage tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/member-usage-query.test.ts src/server/leaderboard.test.ts src/components/member-usage-dialog.test.tsx src/components/member-usage-charts.test.tsx 'src/app/api/leaderboard/members/[username]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck**

Run:

```bash
pnpm --filter @token-burn/web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run repository lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Run the full workspace test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only the intended Member usage grammar, dialog/chart wiring, route test, and read-model/test files changed since the last commit.

- [ ] **Step 6: Report verification evidence**

In the handoff, include the exact commands from Steps 1-4 and whether each passed. Mention any command that could not run and include the failure output summary.
