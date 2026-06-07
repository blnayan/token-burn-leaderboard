# Member Usage Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public, lazy-loaded shadcn bar-chart member usage details that open from leaderboard rows.

**Architecture:** Keep the leaderboard page server-rendered for the initial table, but add a small client layer for row selection, dialog state, and lazy member detail fetches. Add a focused server query module for public aggregate member detail data and expose it through a Next route handler.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma, Vitest, Testing Library, Playwright, shadcn/ui `Dialog`, shadcn/ui `Chart`, shadcn/ui `Skeleton`, Recharts.

---

## File Structure

- Modify `packages/shared/src/schemas.ts`: add `username` to `leaderboardRowSchema`; add public member usage detail schemas and exported types.
- Modify `packages/shared/src/schemas.test.ts`: verify leaderboard row username and member detail response validation.
- Modify `apps/web/src/lib/time.ts`: add a UTC date-window helper for stable all-time trend bars.
- Modify `apps/web/src/lib/time.test.ts`: test the new UTC date-window helper.
- Modify `apps/web/src/server/leaderboard.ts`: include member `username` in rows and export `getMemberUsageDetail`.
- Modify `apps/web/src/server/leaderboard.test.ts`: test username ranking output and member detail aggregation with mocked Prisma calls.
- Create `apps/web/src/app/api/leaderboard/members/[username]/route.ts`: public JSON endpoint for lazy-loaded member detail.
- Create `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`: route handler tests for success, default period, and not found.
- Modify `apps/web/src/components/leaderboard-table.tsx`: convert to a client component that opens a dialog when rows are selected.
- Modify `apps/web/src/components/leaderboard-table.test.tsx`: verify row click opens the member detail dialog and passes the selected period.
- Create `apps/web/src/components/member-usage-dialog.tsx`: dialog shell, fetch state, retry, and cached in-memory detail by username/period.
- Create `apps/web/src/components/member-usage-charts.tsx`: shadcn chart rendering and compact breakdown lists.
- Create `apps/web/src/components/member-usage-dialog.test.tsx`: loading, success, error, retry, and empty-state tests.
- Modify `apps/web/src/app/page.tsx`: pass the current period into `LeaderboardTable`.
- Modify `apps/web/src/app/page.test.tsx`: ensure the mocked leaderboard table receives the current period.
- Modify `apps/web/tests/leaderboard.spec.ts`: add a public click-to-open smoke path.
- Add via shadcn CLI: `apps/web/src/components/ui/chart.tsx` and `apps/web/src/components/ui/skeleton.tsx`; update `apps/web/package.json` and `pnpm-lock.yaml` if Recharts is added.

## Task 1: Shared Public Types

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Write the failing shared schema tests**

Append these tests to `packages/shared/src/schemas.test.ts` and add `memberUsageDetailSchema` to the import list from `./schemas`:

```ts
describe("leaderboardRowSchema", () => {
  it("requires a public member username", () => {
    expect(
      leaderboardRowSchema.parse({
        rank: 1,
        username: "ada",
        displayName: "Ada",
        totalTokens: 100,
        totalCostUsd: 1.25,
      }),
    ).toEqual({
      rank: 1,
      username: "ada",
      displayName: "Ada",
      totalTokens: 100,
      totalCostUsd: 1.25,
    });
  });
});

describe("memberUsageDetailSchema", () => {
  it("accepts public aggregate member usage detail", () => {
    expect(
      memberUsageDetailSchema.parse({
        member: {
          username: "ada",
          displayName: "Ada",
        },
        period: "weekly",
        summary: {
          rank: 1,
          totalTokens: 300,
          totalCostUsd: 3.5,
        },
        trend: [
          {
            date: "2026-06-01",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
        providers: [
          {
            provider: "codex",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
        models: [
          {
            modelName: "gpt-5-codex",
            provider: "codex",
            totalTokens: 80,
            totalCostUsd: 1,
          },
        ],
        devices: [
          {
            deviceName: "Ada MacBook",
            os: "darwin",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
      }),
    ).toMatchObject({
      member: { username: "ada" },
      period: "weekly",
      summary: { rank: 1 },
    });
  });

  it("rejects unsafe aggregate totals", () => {
    expect(() =>
      memberUsageDetailSchema.parse({
        member: {
          username: "ada",
          displayName: "Ada",
        },
        period: "daily",
        summary: {
          rank: null,
          totalTokens: Number.MAX_SAFE_INTEGER + 1,
          totalCostUsd: 0,
        },
        trend: [],
        providers: [],
        models: [],
        devices: [],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the shared tests and verify they fail**

Run:

```sh
pnpm --dir packages/shared test -- schemas.test.ts
```

Expected: FAIL because `memberUsageDetailSchema` is not exported and `leaderboardRowSchema` does not yet include `username`.

- [ ] **Step 3: Implement the shared schemas and types**

In `packages/shared/src/schemas.ts`, replace the existing `leaderboardRowSchema` block with:

```ts
export const leaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  username: z.string().trim().min(1).max(80),
  displayName: z.string().min(1).max(80),
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const memberUsageTrendPointSchema = z.object({
  date: isoDateSchema,
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageProviderBreakdownSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageModelBreakdownSchema = z.object({
  modelName: z.string().trim().min(1).max(160),
  provider: z.string().trim().min(1).max(80),
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageDeviceBreakdownSchema = z.object({
  deviceName: z.string().trim().min(1).max(80),
  os: z.string().trim().min(1).max(40),
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageDetailSchema = z.object({
  member: z.object({
    username: z.string().trim().min(1).max(80),
    displayName: z.string().min(1).max(80),
  }),
  period: periodSchema,
  summary: z.object({
    rank: z.number().int().positive().nullable(),
    totalTokens: z.number().int().nonnegative().safe(),
    totalCostUsd: costUsdSchema,
  }),
  trend: z.array(memberUsageTrendPointSchema),
  providers: z.array(memberUsageProviderBreakdownSchema),
  models: z.array(memberUsageModelBreakdownSchema),
  devices: z.array(memberUsageDeviceBreakdownSchema),
});

export type MemberUsageDetail = z.infer<typeof memberUsageDetailSchema>;
```

- [ ] **Step 4: Run the shared tests and verify they pass**

Run:

```sh
pnpm --dir packages/shared test -- schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat: add member usage detail schema"
```

## Task 2: UTC Trend Window Helper

**Files:**
- Modify: `apps/web/src/lib/time.ts`
- Modify: `apps/web/src/lib/time.test.ts`

- [ ] **Step 1: Write failing tests for UTC date helpers**

Append these tests to `apps/web/src/lib/time.test.ts`:

```ts
describe("getRecentUtcDateWindow", () => {
  it("returns inclusive UTC dates ending on the current UTC date", () => {
    expect(getRecentUtcDateWindow(3, new Date("2026-06-07T15:30:00.000Z"))).toEqual([
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
  });

  it("rejects non-positive window sizes", () => {
    expect(() => getRecentUtcDateWindow(0, new Date("2026-06-07T00:00:00.000Z"))).toThrow(
      "UTC date window must include at least one day",
    );
  });
});
```

Update the import line in that file to:

```ts
import { getPeriodRange, getRecentUtcDateWindow } from "./time";
```

- [ ] **Step 2: Run the focused time tests and verify they fail**

Run:

```sh
pnpm --dir apps/web test -- src/lib/time.test.ts
```

Expected: FAIL because `getRecentUtcDateWindow` does not exist.

- [ ] **Step 3: Implement the helper**

Append this export to `apps/web/src/lib/time.ts`:

```ts
export function getRecentUtcDateWindow(days: number, now = new Date()): string[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("UTC date window must include at least one day");
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = addUtcDays(end, -(days - 1));
  const dates: string[] = [];

  for (let date = start; date <= end; date = addUtcDays(date, 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
}
```

- [ ] **Step 4: Run the focused time tests and verify they pass**

Run:

```sh
pnpm --dir apps/web test -- src/lib/time.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/lib/time.ts apps/web/src/lib/time.test.ts
git commit -m "feat: add utc trend date window"
```

## Task 3: Leaderboard Rows Include Usernames

**Files:**
- Modify: `apps/web/src/server/leaderboard.ts`
- Modify: `apps/web/src/server/leaderboard.test.ts`
- Modify: `apps/web/src/components/leaderboard-table.test.tsx`

- [ ] **Step 1: Write failing rank tests with username output**

In `apps/web/src/server/leaderboard.test.ts`, update `rankRows` test inputs so each raw row includes `username`, and update expected outputs so each row includes `username`.

Use this exact first test body:

```ts
it("sorts by total tokens descending and assigns ranks", () => {
  expect(
    rankRows([
      { username: "ada", displayName: "Ada", totalTokens: 100n, totalCostUsd: 1.25 },
      { username: "linus", displayName: "Linus", totalTokens: 300n, totalCostUsd: 12.5 },
      { username: "grace", displayName: "Grace", totalTokens: 200n, totalCostUsd: 3 },
    ]),
  ).toEqual([
    { rank: 1, username: "linus", displayName: "Linus", totalTokens: 300, totalCostUsd: 12.5 },
    { rank: 2, username: "grace", displayName: "Grace", totalTokens: 200, totalCostUsd: 3 },
    { rank: 3, username: "ada", displayName: "Ada", totalTokens: 100, totalCostUsd: 1.25 },
  ]);
});
```

Use this exact tied-total test body:

```ts
it("sorts tied totals by display name ascending", () => {
  expect(
    rankRows([
      { username: "linus", displayName: "Linus", totalTokens: 200n, totalCostUsd: 2 },
      { username: "ada", displayName: "Ada", totalTokens: 200n, totalCostUsd: 1 },
      { username: "grace", displayName: "Grace", totalTokens: 300n, totalCostUsd: 3 },
    ]),
  ).toEqual([
    { rank: 1, username: "grace", displayName: "Grace", totalTokens: 300, totalCostUsd: 3 },
    { rank: 2, username: "ada", displayName: "Ada", totalTokens: 200, totalCostUsd: 1 },
    { rank: 3, username: "linus", displayName: "Linus", totalTokens: 200, totalCostUsd: 2 },
  ]);
});
```

In `apps/web/src/components/leaderboard-table.test.tsx`, add `username: "ada"` to the test row.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```sh
pnpm --dir apps/web test -- src/server/leaderboard.test.ts src/components/leaderboard-table.test.tsx
```

Expected: FAIL because `RawRow` does not include `username` and `rankRows` does not return it.

- [ ] **Step 3: Implement username support in leaderboard rows**

In `apps/web/src/server/leaderboard.ts`, change `RawRow` to:

```ts
export type RawRow = {
  username: string;
  displayName: string;
  totalTokens: bigint;
  totalCostUsd: number;
};
```

In `rankRows`, include `username` in the mapped row:

```ts
.map((row, index) => ({
  rank: index + 1,
  username: row.username,
  displayName: row.displayName,
  totalTokens: bigIntToSafeNumber(row.totalTokens),
  totalCostUsd: row.totalCostUsd,
}));
```

In `getLeaderboard`, update the member select to:

```ts
select: {
  id: true,
  username: true,
  displayName: true,
},
```

Replace the display-name map with a member map:

```ts
const membersByMemberId = new Map(members.map((member) => [member.id, member]));
```

Replace the `flatMap` return block with:

```ts
const member = membersByMemberId.get(total.memberId);
const totalTokens = total._sum.totalTokens;
const totalCostUsd = total._sum.costUsd === null ? 0 : Number(total._sum.costUsd);

if (!member || totalTokens === null) return [];

return [
  {
    username: member.username,
    displayName: member.displayName,
    totalTokens,
    totalCostUsd,
  },
];
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```sh
pnpm --dir apps/web test -- src/server/leaderboard.test.ts src/components/leaderboard-table.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/server/leaderboard.ts apps/web/src/server/leaderboard.test.ts apps/web/src/components/leaderboard-table.test.tsx
git commit -m "feat: expose leaderboard member usernames"
```

## Task 4: Server Member Usage Detail Query

**Files:**
- Modify: `apps/web/src/server/leaderboard.ts`
- Modify: `apps/web/src/server/leaderboard.test.ts`

- [ ] **Step 1: Add Prisma mocks and failing detail query tests**

At the top of `apps/web/src/server/leaderboard.test.ts`, before importing from `./leaderboard`, add:

```ts
import { beforeEach, vi } from "vitest";

vi.mock("../lib/prisma", () => ({
  prisma: {
    member: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    dailyProviderUsage: {
      groupBy: vi.fn(),
    },
    dailyModelUsage: {
      groupBy: vi.fn(),
    },
  },
}));
```

Update the leaderboard import to include `getMemberUsageDetail`:

```ts
import { bigIntToSafeNumber, getMemberUsageDetail, rankRows } from "./leaderboard";
```

After imports, add:

```ts
import { prisma } from "../lib/prisma";

const prismaMock = prisma as unknown as {
  member: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  dailyProviderUsage: {
    groupBy: ReturnType<typeof vi.fn>;
  };
  dailyModelUsage: {
    groupBy: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  prismaMock.member.findUnique.mockReset();
  prismaMock.member.findMany.mockReset();
  prismaMock.dailyProviderUsage.groupBy.mockReset();
  prismaMock.dailyModelUsage.groupBy.mockReset();
});
```

Append this test block:

```ts
describe("getMemberUsageDetail", () => {
  it("aggregates public weekly member usage detail", async () => {
    prismaMock.member.findUnique.mockResolvedValue({
      id: "member-1",
      username: "ada",
      displayName: "Ada",
    });
    prismaMock.dailyProviderUsage.groupBy
      .mockResolvedValueOnce([
        {
          date: new Date("2026-06-01T00:00:00.000Z"),
          _sum: { totalTokens: 100n, costUsd: 1.25 },
        },
        {
          date: new Date("2026-06-02T00:00:00.000Z"),
          _sum: { totalTokens: 200n, costUsd: 2.5 },
        },
      ])
      .mockResolvedValueOnce([{ provider: "codex", _sum: { totalTokens: 300n, costUsd: 3.75 } }])
      .mockResolvedValueOnce([
        {
          deviceId: "device-1",
          _sum: { totalTokens: 300n, costUsd: 3.75 },
        },
      ]);
    prismaMock.dailyModelUsage.groupBy.mockResolvedValue([
      {
        provider: "codex",
        modelName: "gpt-5-codex",
        _sum: { totalTokens: 250n, costUsd: 3 },
      },
    ]);
    prismaMock.member.findMany.mockResolvedValue([
      {
        devices: [{ id: "device-1", name: "Ada MacBook", os: "darwin" }],
      },
    ]);

    await expect(
      getMemberUsageDetail("ada", "weekly", new Date("2026-06-03T12:00:00.000Z")),
    ).resolves.toEqual({
      member: { username: "ada", displayName: "Ada" },
      period: "weekly",
      summary: { rank: null, totalTokens: 300, totalCostUsd: 3.75 },
      trend: [
        { date: "2026-06-01", totalTokens: 100, totalCostUsd: 1.25 },
        { date: "2026-06-02", totalTokens: 200, totalCostUsd: 2.5 },
      ],
      providers: [{ provider: "codex", totalTokens: 300, totalCostUsd: 3.75 }],
      models: [
        { provider: "codex", modelName: "gpt-5-codex", totalTokens: 250, totalCostUsd: 3 },
      ],
      devices: [{ deviceName: "Ada MacBook", os: "darwin", totalTokens: 300, totalCostUsd: 3.75 }],
    });
  });

  it("uses a 30-day zero-filled trend for all-time", async () => {
    prismaMock.member.findUnique.mockResolvedValue({
      id: "member-1",
      username: "ada",
      displayName: "Ada",
    });
    prismaMock.dailyProviderUsage.groupBy
      .mockResolvedValueOnce([
        {
          date: new Date("2026-06-07T00:00:00.000Z"),
          _sum: { totalTokens: 50n, costUsd: 0.5 },
        },
      ])
      .mockResolvedValueOnce([{ provider: "codex", _sum: { totalTokens: 500n, costUsd: 5 } }])
      .mockResolvedValueOnce([]);
    prismaMock.dailyModelUsage.groupBy.mockResolvedValue([]);
    prismaMock.member.findMany.mockResolvedValue([]);

    const detail = await getMemberUsageDetail("ada", "all-time", new Date("2026-06-07T12:00:00.000Z"));

    expect(detail?.summary).toEqual({ rank: null, totalTokens: 500, totalCostUsd: 5 });
    expect(detail?.trend).toHaveLength(30);
    expect(detail?.trend[0]).toEqual({ date: "2026-05-09", totalTokens: 0, totalCostUsd: 0 });
    expect(detail?.trend.at(-1)).toEqual({ date: "2026-06-07", totalTokens: 50, totalCostUsd: 0.5 });
  });

  it("returns null for unknown members", async () => {
    prismaMock.member.findUnique.mockResolvedValue(null);

    await expect(getMemberUsageDetail("missing", "daily")).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```sh
pnpm --dir apps/web test -- src/server/leaderboard.test.ts
```

Expected: FAIL because `getMemberUsageDetail` is not implemented.

- [ ] **Step 3: Implement member detail aggregation**

In `apps/web/src/server/leaderboard.ts`, update imports:

```ts
import type { LeaderboardPeriod, LeaderboardRow, MemberUsageDetail } from "@token-burn/shared";
import { prisma } from "../lib/prisma";
import { getPeriodRange, getRecentUtcDateWindow } from "../lib/time";
```

Add these helper types and functions below `bigIntToSafeNumber`:

```ts
type DateFilter = { gte: Date; lt: Date };

function toCost(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildDateFilter(period: LeaderboardPeriod, now: Date): DateFilter | undefined {
  const range = getPeriodRange(period, now);

  if (range.start === null || range.end === null) return undefined;

  return {
    gte: range.start,
    lt: range.end,
  };
}

function getAllTimeTrendFilter(now: Date): DateFilter {
  const dates = getRecentUtcDateWindow(30, now);
  const start = new Date(`${dates[0]}T00:00:00.000Z`);
  const end = new Date(`${dates.at(-1)}T00:00:00.000Z`);

  return {
    gte: start,
    lt: new Date(end.getTime() + 24 * 60 * 60 * 1000),
  };
}
```

Append this exported function:

```ts
export async function getMemberUsageDetail(
  username: string,
  period: LeaderboardPeriod,
  now = new Date(),
): Promise<MemberUsageDetail | null> {
  const member = await prisma.member.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
    },
  });

  if (!member) return null;

  const periodDateFilter = buildDateFilter(period, now);
  const trendDateFilter = period === "all-time" ? getAllTimeTrendFilter(now) : periodDateFilter;
  const periodWhere = periodDateFilter
    ? { memberId: member.id, date: periodDateFilter }
    : { memberId: member.id };
  const trendWhere = trendDateFilter
    ? { memberId: member.id, date: trendDateFilter }
    : { memberId: member.id };

  const [trendRows, providerRows, modelRows, deviceRows] = await Promise.all([
    prisma.dailyProviderUsage.groupBy({
      by: ["date"],
      _sum: {
        totalTokens: true,
        costUsd: true,
      },
      where: trendWhere,
      orderBy: {
        date: "asc",
      },
    }),
    prisma.dailyProviderUsage.groupBy({
      by: ["provider"],
      _sum: {
        totalTokens: true,
        costUsd: true,
      },
      where: periodWhere,
      orderBy: {
        _sum: {
          totalTokens: "desc",
        },
      },
    }),
    prisma.dailyModelUsage.groupBy({
      by: ["provider", "modelName"],
      _sum: {
        totalTokens: true,
        costUsd: true,
      },
      where: periodWhere,
      orderBy: {
        _sum: {
          totalTokens: "desc",
        },
      },
      take: 5,
    }),
    prisma.dailyProviderUsage.groupBy({
      by: ["deviceId"],
      _sum: {
        totalTokens: true,
        costUsd: true,
      },
      where: periodWhere,
      orderBy: {
        _sum: {
          totalTokens: "desc",
        },
      },
      take: 5,
    }),
  ]);

  const devicesById = await loadDevicesById(deviceRows.map((row) => row.deviceId));
  const trendTotalsByDate = new Map(
    trendRows.map((row) => [
      toIsoDate(row.date),
      {
        totalTokens: bigIntToSafeNumber(row._sum.totalTokens ?? 0n),
        totalCostUsd: toCost(row._sum.costUsd),
      },
    ]),
  );
  const trendDates =
    period === "all-time"
      ? getRecentUtcDateWindow(30, now)
      : trendRows.map((row) => toIsoDate(row.date));
  const providers = providerRows.map((row) => ({
    provider: row.provider,
    totalTokens: bigIntToSafeNumber(row._sum.totalTokens ?? 0n),
    totalCostUsd: toCost(row._sum.costUsd),
  }));
  const summary = providers.reduce(
    (total, provider) => ({
      rank: null,
      totalTokens: total.totalTokens + provider.totalTokens,
      totalCostUsd: total.totalCostUsd + provider.totalCostUsd,
    }),
    { rank: null, totalTokens: 0, totalCostUsd: 0 },
  );

  return {
    member: {
      username: member.username,
      displayName: member.displayName,
    },
    period,
    summary,
    trend: trendDates.map((date) => ({
      date,
      totalTokens: trendTotalsByDate.get(date)?.totalTokens ?? 0,
      totalCostUsd: trendTotalsByDate.get(date)?.totalCostUsd ?? 0,
    })),
    providers,
    models: modelRows.map((row) => ({
      provider: row.provider,
      modelName: row.modelName,
      totalTokens: bigIntToSafeNumber(row._sum.totalTokens ?? 0n),
      totalCostUsd: toCost(row._sum.costUsd),
    })),
    devices: deviceRows.flatMap((row) => {
      const device = devicesById.get(row.deviceId);
      if (!device) return [];

      return [
        {
          deviceName: device.name,
          os: device.os,
          totalTokens: bigIntToSafeNumber(row._sum.totalTokens ?? 0n),
          totalCostUsd: toCost(row._sum.costUsd),
        },
      ];
    }),
  };
}

async function loadDevicesById(deviceIds: string[]): Promise<Map<string, { name: string; os: string }>> {
  if (deviceIds.length === 0) return new Map();

  const members = await prisma.member.findMany({
    where: {
      devices: {
        some: {
          id: {
            in: deviceIds,
          },
        },
      },
    },
    select: {
      devices: {
        where: {
          id: {
            in: deviceIds,
          },
        },
        select: {
          id: true,
          name: true,
          os: true,
        },
      },
    },
  });

  return new Map(
    members.flatMap((member) => member.devices.map((device) => [device.id, { name: device.name, os: device.os }])),
  );
}
```

- [ ] **Step 4: Run the focused server tests and fix type errors**

Run:

```sh
pnpm --dir apps/web test -- src/server/leaderboard.test.ts
```

Expected: PASS. If TypeScript reports Prisma mock shape errors in tests, narrow the mocked values with `as never` at the callsite rather than weakening production types.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/server/leaderboard.ts apps/web/src/server/leaderboard.test.ts
git commit -m "feat: aggregate member usage detail"
```

## Task 5: Public Member Detail API Route

**Files:**
- Create: `apps/web/src/app/api/leaderboard/members/[username]/route.ts`
- Create: `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/leaderboard", () => ({
  getMemberUsageDetail: vi.fn(),
}));

import { getMemberUsageDetail } from "@/server/leaderboard";

import { GET } from "./route";

const getMemberUsageDetailMock = getMemberUsageDetail as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/leaderboard/members/[username]", () => {
  beforeEach(() => {
    getMemberUsageDetailMock.mockReset();
  });

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
    expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "weekly");
    await expect(response.json()).resolves.toMatchObject({
      member: { username: "ada" },
      period: "weekly",
    });
  });

  it("defaults invalid periods to daily", async () => {
    getMemberUsageDetailMock.mockResolvedValue({
      member: { username: "ada", displayName: "Ada" },
      period: "daily",
      summary: { rank: null, totalTokens: 0, totalCostUsd: 0 },
      trend: [],
      providers: [],
      models: [],
      devices: [],
    });

    await GET(new NextRequest("https://token-burn.test/api/leaderboard/members/ada?period=nope"), {
      params: Promise.resolve({ username: "ada" }),
    });

    expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "daily");
  });

  it("returns 404 when the member is missing", async () => {
    getMemberUsageDetailMock.mockResolvedValue(null);

    const response = await GET(new NextRequest("https://token-burn.test/api/leaderboard/members/missing"), {
      params: Promise.resolve({ username: "missing" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Member not found" });
  });
});
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```sh
pnpm --dir apps/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts'
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/leaderboard/members/[username]/route.ts`:

```ts
import { memberUsageDetailSchema, periodSchema } from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getMemberUsageDetail } from "@/server/leaderboard";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const period = periodSchema.catch("daily").parse(request.nextUrl.searchParams.get("period") ?? undefined);
  const detail = await getMemberUsageDetail(username, period);

  if (!detail) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  return NextResponse.json(memberUsageDetailSchema.parse(detail));
}
```

- [ ] **Step 4: Run route tests and verify they pass**

Run:

```sh
pnpm --dir apps/web test -- 'src/app/api/leaderboard/members/[username]/route.test.ts'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add 'apps/web/src/app/api/leaderboard/members/[username]/route.ts' 'apps/web/src/app/api/leaderboard/members/[username]/route.test.ts'
git commit -m "feat: add public member usage API"
```

## Task 6: Add shadcn Chart and Skeleton Components

**Files:**
- Create: `apps/web/src/components/ui/chart.tsx`
- Create: `apps/web/src/components/ui/skeleton.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the shadcn components**

Run:

```sh
pnpm --dir apps/web dlx shadcn@latest add chart skeleton
```

Expected: `apps/web/src/components/ui/chart.tsx` and `apps/web/src/components/ui/skeleton.tsx` are created. `recharts` is added if it is not already present.

- [ ] **Step 2: Inspect generated files**

Run:

```sh
sed -n '1,260p' apps/web/src/components/ui/chart.tsx
sed -n '1,160p' apps/web/src/components/ui/skeleton.tsx
rg --line-number 'recharts|@/lib/utils|ChartContainer|Skeleton' apps/web/src/components/ui/chart.tsx apps/web/src/components/ui/skeleton.tsx apps/web/package.json
```

Expected: imports use `@/lib/utils`; `ChartContainer`, `ChartTooltip`, and `ChartTooltipContent` are exported; `Skeleton` is exported.

- [ ] **Step 3: Run typecheck to catch generated import issues**

Run:

```sh
pnpm --dir apps/web typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```sh
git add apps/web/src/components/ui/chart.tsx apps/web/src/components/ui/skeleton.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add shadcn chart components"
```

## Task 7: Member Usage Dialog and Charts

**Files:**
- Create: `apps/web/src/components/member-usage-dialog.tsx`
- Create: `apps/web/src/components/member-usage-charts.tsx`
- Create: `apps/web/src/components/member-usage-dialog.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Create `apps/web/src/components/member-usage-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemberUsageDialog } from "./member-usage-dialog";

const fetchMock = vi.fn();

describe("MemberUsageDialog", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("fetches member detail when opened", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => createDetail(),
    });

    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        period="weekly"
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(screen.getByText("Loading member usage...")).toBeTruthy();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard/members/ada?period=weekly");
    });
    expect(await screen.findByRole("heading", { name: "Ada" })).toBeTruthy();
    expect(screen.getByText("100 tokens")).toBeTruthy();
  });

  it("shows a retryable error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => createDetail(),
    });

    const user = userEvent.setup();
    render(
      <MemberUsageDialog
        member={{ username: "ada", displayName: "Ada", rank: 1 }}
        period="weekly"
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(await screen.findByText("Could not load member usage.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("100 tokens")).toBeTruthy();
  });
});

function createDetail() {
  return {
    member: { username: "ada", displayName: "Ada" },
    period: "weekly",
    summary: { rank: null, totalTokens: 100, totalCostUsd: 1.25 },
    trend: [{ date: "2026-06-01", totalTokens: 100, totalCostUsd: 1.25 }],
    providers: [{ provider: "codex", totalTokens: 100, totalCostUsd: 1.25 }],
    models: [{ provider: "codex", modelName: "gpt-5-codex", totalTokens: 100, totalCostUsd: 1.25 }],
    devices: [{ deviceName: "Ada MacBook", os: "darwin", totalTokens: 100, totalCostUsd: 1.25 }],
  };
}
```

- [ ] **Step 2: Run dialog tests and verify they fail**

Run:

```sh
pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx
```

Expected: FAIL because the dialog component does not exist.

- [ ] **Step 3: Implement the charts component**

Create `apps/web/src/components/member-usage-charts.tsx`:

```tsx
"use client";

import { type MemberUsageDetail, formatTokens, formatUsd } from "@token-burn/shared";
import React from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const chartConfig = {
  totalTokens: {
    label: "Tokens",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function MemberUsageCharts({ detail }: { detail: MemberUsageDetail }) {
  const hasTrend = detail.trend.some((point) => point.totalTokens > 0 || point.totalCostUsd > 0);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Usage trend</h3>
          <p className="text-xs text-muted-foreground">Daily token totals</p>
        </div>
        {hasTrend ? (
          <ChartContainer config={chartConfig} className="h-[220px] w-full">
            <BarChart accessibilityLayer data={detail.trend}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                tickMargin={10}
                axisLine={false}
                tickFormatter={(value: string) => value.slice(5)}
              />
              <ChartTooltip
                content={<ChartTooltipContent labelKey="date" nameKey="totalTokens" />}
              />
              <Bar dataKey="totalTokens" fill="var(--color-totalTokens)" radius={4} />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[220px] items-center justify-center rounded-md border text-sm text-muted-foreground">
            No usage in this period.
          </div>
        )}
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <BreakdownList
          title="Providers"
          items={detail.providers.map((provider) => ({
            label: provider.provider,
            value: `${formatTokens(provider.totalTokens)} · ${formatUsd(provider.totalCostUsd)}`,
          }))}
        />
        <BreakdownList
          title="Models"
          items={detail.models.map((model) => ({
            label: model.modelName,
            value: `${formatTokens(model.totalTokens)} · ${formatUsd(model.totalCostUsd)}`,
          }))}
        />
        <BreakdownList
          title="Devices"
          items={detail.devices.map((device) => ({
            label: device.deviceName,
            value: `${formatTokens(device.totalTokens)} · ${formatUsd(device.totalCostUsd)}`,
          }))}
        />
      </div>
    </div>
  );
}

function BreakdownList({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data.</p>
      ) : (
        <dl className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={`${title}-${item.label}`} className="flex items-center justify-between gap-3 text-sm">
              <dt className="truncate text-muted-foreground">{item.label}</dt>
              <dd className="shrink-0 font-mono">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Implement the dialog component**

Create `apps/web/src/components/member-usage-dialog.tsx`:

```tsx
"use client";

import { memberUsageDetailSchema, type LeaderboardPeriod, type MemberUsageDetail } from "@token-burn/shared";
import { formatTokens, formatUsd } from "@token-burn/shared";
import React from "react";

import { MemberUsageCharts } from "@/components/member-usage-charts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type MemberSummary = {
  username: string;
  displayName: string;
  rank: number;
};

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "success"; detail: MemberUsageDetail }
  | { status: "error" };

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
  const [state, setState] = React.useState<LoadState>({ status: "idle" });

  const load = React.useCallback(async () => {
    if (!member) return;

    setState({ status: "loading" });

    try {
      const response = await fetch(`/api/leaderboard/members/${member.username}?period=${period}`);
      if (!response.ok) throw new Error(`Member usage request failed with ${response.status}`);
      const detail = memberUsageDetailSchema.parse(await response.json());
      setState({ status: "success", detail });
    } catch {
      setState({ status: "error" });
    }
  }, [member, period]);

  React.useEffect(() => {
    if (open && member) void load();
  }, [load, member, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{member?.displayName ?? "Member usage"}</DialogTitle>
          <DialogDescription>
            Public aggregate usage detail for the selected leaderboard period.
          </DialogDescription>
        </DialogHeader>
        {state.status === "loading" || state.status === "idle" ? (
          <MemberUsageDialogSkeleton />
        ) : state.status === "error" ? (
          <div className="flex flex-col gap-3 rounded-md border p-4">
            <p className="text-sm text-muted-foreground">Could not load member usage.</p>
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <SummaryStat label="Rank" value={member ? `#${member.rank}` : "—"} />
              <SummaryStat label="Tokens" value={formatTokens(state.detail.summary.totalTokens)} />
              <SummaryStat label="Cost" value={formatUsd(state.detail.summary.totalCostUsd)} />
            </div>
            <MemberUsageCharts detail={state.detail} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-medium">{value}</div>
    </div>
  );
}

function MemberUsageDialogSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading member usage...">
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-16 rounded-md" />
      </div>
      <Skeleton className="h-[220px] rounded-md" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28 rounded-md" />
        <Skeleton className="h-28 rounded-md" />
        <Skeleton className="h-28 rounded-md" />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run dialog tests and verify they pass**

Run:

```sh
pnpm --dir apps/web test -- src/components/member-usage-dialog.test.tsx
```

Expected: PASS. If Recharts needs browser APIs in jsdom, mock `MemberUsageCharts` in the dialog test and add a separate render test for `MemberUsageCharts` that checks list/empty text instead of canvas/SVG internals.

- [ ] **Step 6: Commit**

```sh
git add apps/web/src/components/member-usage-dialog.tsx apps/web/src/components/member-usage-charts.tsx apps/web/src/components/member-usage-dialog.test.tsx
git commit -m "feat: add member usage dialog charts"
```

## Task 8: Clickable Leaderboard Rows

**Files:**
- Modify: `apps/web/src/components/leaderboard-table.tsx`
- Modify: `apps/web/src/components/leaderboard-table.test.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/app/page.test.tsx`

- [ ] **Step 1: Write failing table and page tests**

In `apps/web/src/components/leaderboard-table.test.tsx`, import `userEvent`:

```ts
import userEvent from "@testing-library/user-event";
```

Mock `MemberUsageDialog` before importing `LeaderboardTable`:

```ts
vi.mock("./member-usage-dialog", () => ({
  MemberUsageDialog: ({
    member,
    period,
    open,
  }: {
    member: { displayName: string } | null;
    period: string;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="member-usage-dialog">
        {member?.displayName} · {period}
      </div>
    ) : null,
}));
```

Add this test:

```tsx
it("opens member details when a row is clicked", async () => {
  const user = userEvent.setup();

  render(
    <LeaderboardTable
      period="weekly"
      rows={[
        {
          rank: 1,
          username: "ada",
          displayName: "Ada",
          totalTokens: 12400,
          totalCostUsd: 1234.5,
        },
      ]}
    />,
  );

  await user.click(screen.getByRole("button", { name: /Open usage details for Ada/ }));

  expect(screen.getByTestId("member-usage-dialog").textContent).toBe("Ada · weekly");
});
```

Update the existing table render in that test file to pass `period="daily"`.

In `apps/web/src/app/page.test.tsx`, change the leaderboard table mock to capture props:

```tsx
vi.mock("@/components/leaderboard-table", () => ({
  LeaderboardTable: ({ period }: { period: string }) => (
    <div data-testid="leaderboard-table" data-period={period} />
  ),
}));
```

Add this assertion to the existing "renders the leaderboard" test:

```ts
expect(screen.getByTestId("leaderboard-table").getAttribute("data-period")).toBe("daily");
```

- [ ] **Step 2: Run focused component/page tests and verify they fail**

Run:

```sh
pnpm --dir apps/web test -- src/components/leaderboard-table.test.tsx src/app/page.test.tsx
```

Expected: FAIL because `LeaderboardTable` does not accept `period` and rows are not interactive.

- [ ] **Step 3: Implement clickable rows**

Replace `apps/web/src/components/leaderboard-table.tsx` with:

```tsx
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

export function LeaderboardTable({
  period,
  rows,
}: {
  period: LeaderboardPeriod;
  rows: LeaderboardRow[];
}) {
  const [selectedRow, setSelectedRow] = React.useState<LeaderboardRow | null>(null);

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
              <TableRow key={row.username}>
                <TableCell className="font-mono text-muted-foreground">#{row.rank}</TableCell>
                <TableCell className="font-medium">
                  <button
                    type="button"
                    className="text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => setSelectedRow(row)}
                  >
                    <span className="sr-only">Open usage details for </span>
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
        member={
          selectedRow
            ? {
                username: selectedRow.username,
                displayName: selectedRow.displayName,
                rank: selectedRow.rank,
              }
            : null
        }
        period={period}
        open={selectedRow !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedRow(null);
        }}
      />
    </>
  );
}
```

In `apps/web/src/app/page.tsx`, update the table call:

```tsx
<LeaderboardTable period={period} rows={rows} />
```

- [ ] **Step 4: Run focused component/page tests and verify they pass**

Run:

```sh
pnpm --dir apps/web test -- src/components/leaderboard-table.test.tsx src/app/page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add apps/web/src/components/leaderboard-table.tsx apps/web/src/components/leaderboard-table.test.tsx apps/web/src/app/page.tsx apps/web/src/app/page.test.tsx
git commit -m "feat: open member usage from leaderboard"
```

## Task 9: Playwright Smoke Path

**Files:**
- Modify: `apps/web/tests/leaderboard.spec.ts`

- [ ] **Step 1: Add a public interaction smoke test**

Append this test to `apps/web/tests/leaderboard.spec.ts`:

```ts
test("member usage details open from a leaderboard row when data exists", async ({ page }) => {
  await page.goto("/");

  const adaRowTrigger = page.getByRole("button", { name: /Open usage details for/i }).first();
  const triggerCount = await adaRowTrigger.count();

  test.skip(triggerCount === 0, "No seeded leaderboard rows available in this environment");

  await adaRowTrigger.click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Usage trend")).toBeVisible();
});
```

- [ ] **Step 2: Run Playwright smoke test**

Run:

```sh
pnpm --dir apps/web test:e2e -- leaderboard.spec.ts
```

Expected: PASS or SKIP for the new test when the local e2e database has no seeded usage rows. The existing public render test must still PASS.

- [ ] **Step 3: Commit**

```sh
git add apps/web/tests/leaderboard.spec.ts
git commit -m "test: smoke member usage dialog"
```

## Task 10: Full Verification

**Files:**
- No new files. This task verifies the integrated feature.

- [ ] **Step 1: Run all unit tests**

Run:

```sh
pnpm --dir packages/shared test
pnpm --dir apps/web test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck and lint**

Run:

```sh
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
```

Expected: PASS.

- [ ] **Step 3: Run web build**

Run:

```sh
pnpm --dir apps/web build
```

Expected: PASS.

- [ ] **Step 4: Inspect final git diff**

Run:

```sh
git status --short
git log --oneline -10
```

Expected: the worktree is clean after the task commits, and the recent log includes each task commit.

## Self-Review

- Spec coverage: covered public aggregate data, centered dialog, lazy API fetch, hybrid period behavior, bar chart trend, shadcn chart/dialog/skeleton usage, empty/error states, accessibility, server tests, component tests, and Playwright smoke coverage.
- Placeholder scan: no `TBD`, `TODO`, "implement later", or unspecified edge handling remains in the plan.
- Type consistency: the plan consistently uses `username`, `MemberUsageDetail`, `memberUsageDetailSchema`, `getMemberUsageDetail`, `period`, `totalTokens`, and `totalCostUsd`.
