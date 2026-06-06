# High-Water Sync Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent server-side token totals from decreasing and make the CLI ask `ccusage` only for server-directed UTC sync windows.

**Architecture:** Add a shared sync-window response contract, enforce high-water persistence in the web ingest helper, add an authenticated `/api/cli/sync-windows` endpoint, and update the CLI to fetch provider windows before invoking `ccusage`. The server remains the correctness layer; the CLI date flags are only an optimization.

**Tech Stack:** TypeScript, Zod 4, Vitest, Prisma 7, Next.js route handlers, Commander CLI internals, `ccusage`.

---

## File Structure

- Modify `packages/shared/src/schemas.ts`: export server-known provider values and add sync-window response schemas/types.
- Modify `packages/shared/src/schemas.test.ts`: cover sync-window schema validation and future-provider-safe shape.
- Modify `apps/web/src/server/sync-ingest.ts`: replace blind daily usage upsert with high-water create/update/preserve logic.
- Modify `apps/web/src/server/sync-ingest.test.ts`: add create, higher, equal, and lower snapshot persistence tests.
- Create `apps/web/src/server/sync-windows.ts`: compute provider-specific windows for one authenticated member and client device ID.
- Create `apps/web/src/server/sync-windows.test.ts`: test UTC dates, omitted `since`, and provider independence.
- Create `apps/web/src/app/api/cli/sync-windows/route.ts`: authenticate CLI tokens and return sync windows.
- Create `apps/web/src/app/api/cli/sync-windows/route.test.ts`: test auth and request validation.
- Modify `packages/cli/src/ccusage.ts`: accept optional provider date windows and include `--since`/`--until` flags.
- Modify `packages/cli/src/ccusage.test.ts`: cover date-window args and Claude fallback preserving window args.
- Modify `packages/cli/src/sync.ts`: fetch sync windows from the server, persist device ID before window lookup, pass provider windows to `readProviderUsage`, and tolerate providers with no local rows.
- Modify `packages/cli/src/sync.test.ts`: cover server-directed windows, omitted `since`, provider skips, and unknown server provider entries.

## Task 1: Shared Sync-Window Contract

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Add `syncWindowsResponseSchema` to the import list in `packages/shared/src/schemas.test.ts`:

```ts
import {
  leaderboardRowSchema,
  periodSchema,
  providerSchema,
  syncPayloadSchema,
  syncWindowsResponseSchema,
  tokenCategoriesSchema,
} from "./schemas";
```

Add this block after the `syncPayloadSchema` tests:

```ts
describe("syncWindowsResponseSchema", () => {
  it("accepts provider-specific UTC sync windows", () => {
    const payload = syncWindowsResponseSchema.parse({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [
        { provider: "claude_code", since: "2026-06-05" },
        { provider: "codex" },
      ],
    });

    expect(payload.until).toBe("2026-06-06");
    expect(payload.providers[0]?.since).toBe("2026-06-05");
    expect(payload.providers[1]?.since).toBeUndefined();
  });

  it("allows future provider names so older CLIs can ignore them", () => {
    const payload = syncWindowsResponseSchema.parse({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [{ provider: "future_provider", since: "2026-06-05" }],
    });

    expect(payload.providers[0]?.provider).toBe("future_provider");
  });

  it("rejects malformed dates", () => {
    expect(() =>
      syncWindowsResponseSchema.parse({
        serverTime: "2026-06-06T12:00:00.000Z",
        until: "20260606",
        providers: [{ provider: "codex", since: "2026-06-05" }],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run shared tests and verify they fail**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: FAIL because `syncWindowsResponseSchema` is not exported.

- [ ] **Step 3: Implement shared schema**

In `packages/shared/src/schemas.ts`, add an exported provider list directly after `providerSchema`:

```ts
export const providerSchema = z.enum(["claude_code", "codex"]);
export const providers = providerSchema.options;
export type Provider = z.infer<typeof providerSchema>;
```

Add the sync-window schemas after `syncPayloadSchema` and before `leaderboardRowSchema`:

```ts
export const syncWindowProviderSchema = z.object({
  provider: z.string().trim().min(1),
  since: isoDateSchema.optional(),
});

export type SyncWindowProvider = z.infer<typeof syncWindowProviderSchema>;

export const syncWindowsResponseSchema = z.object({
  serverTime: z.string().datetime(),
  until: isoDateSchema,
  providers: z.array(syncWindowProviderSchema),
});

export type SyncWindowsResponse = z.infer<typeof syncWindowsResponseSchema>;
```

- [ ] **Step 4: Run shared tests and verify they pass**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared contract**

Run:

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat(shared): add sync window contract"
```

## Task 2: Server High-Water Ingest

**Files:**
- Modify: `apps/web/src/server/sync-ingest.ts`
- Modify: `apps/web/src/server/sync-ingest.test.ts`

- [ ] **Step 1: Write failing lower-snapshot preservation test**

In `apps/web/src/server/sync-ingest.test.ts`, extend `createTransactionMock` so `dailyProviderUsage` has `findUnique`, `create`, and `update` mocks:

```ts
dailyProviderUsage: {
  findUnique: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({ id: "usage-1" }),
  update: vi.fn().mockResolvedValue({ id: "usage-1" }),
  upsert: vi.fn().mockResolvedValue({ id: "usage-1" }),
},
```

Then add this test inside `describe("persistSyncPayload", ...)`:

```ts
it("preserves an existing higher daily provider snapshot", async () => {
  const tx = createTransactionMock();
  tx.dailyProviderUsage.findUnique.mockResolvedValue({
    id: "usage-1",
    totalTokens: 200n,
  });
  const prisma = createPrismaMock(tx);
  const payload = createPayload({
    tokenCategories: { input: 100 },
    totalTokens: 100,
    models: [
      {
        modelName: "gpt-5.5",
        tokenCategories: { input: 100 },
        totalTokens: 100,
      },
    ],
  });

  await persistSyncPayload({
    prisma,
    cliTokenId: "cli-token-1",
    memberId: "member-1",
    payload,
  });

  expect(tx.dailyProviderUsage.update).not.toHaveBeenCalled();
  expect(tx.dailyModelUsage.deleteMany).not.toHaveBeenCalled();
  expect(tx.dailyModelUsage.createMany).not.toHaveBeenCalled();
  expect(tx.cliToken.update).toHaveBeenCalledWith({
    where: { id: "cli-token-1" },
    data: { lastUsedAt: expect.any(Date) },
  });
});
```

- [ ] **Step 2: Run ingest tests and verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-ingest.test.ts
```

Expected: FAIL because the current implementation still calls `upsert` and replaces model rows for lower snapshots.

- [ ] **Step 3: Replace upsert expectations for create/update behavior**

Update the existing `"upserts daily provider cost/detail fields and replaces model rows"` test name to:

```ts
it("creates daily provider cost/detail fields and model rows", async () => {
```

Replace its `expect(tx.dailyProviderUsage.upsert).toHaveBeenCalledWith(...)` assertion with:

```ts
expect(tx.dailyProviderUsage.findUnique).toHaveBeenCalledWith({
  where: {
    deviceId_provider_date: {
      deviceId: "device-1",
      provider: "codex",
      date,
    },
  },
  select: { id: true, totalTokens: true },
});
expect(tx.dailyProviderUsage.create).toHaveBeenCalledWith({
  data: {
    memberId: "member-1",
    deviceId: "device-1",
    provider: "codex",
    date,
    tokenCategories: { input: 100, output: 50 },
    tokenDetails: { reasoningOutput: 20 },
    totalTokens: 150n,
    costUsd: "1.234567",
    costSource: "ccusage",
    costMetadata: { currency: "USD" },
    sourceSnapshot: { costUSD: 1.234567, totalTokens: 150 },
    cliVersion: "0.1.0",
    ccusageVersion: "16.2.5",
    os: "linux",
    syncedAt,
  },
  select: { id: true },
});
```

Add an equal-total refresh test:

```ts
it("accepts an equal total and refreshes provider details", async () => {
  const tx = createTransactionMock();
  tx.dailyProviderUsage.findUnique.mockResolvedValue({
    id: "usage-1",
    totalTokens: 150n,
  });
  const prisma = createPrismaMock(tx);
  const payload = createPayload({
    tokenCategories: { input: 150 },
    totalTokens: 150,
    costUsd: 2,
    sourceSnapshot: { totalTokens: 150, costUSD: 2 },
  });

  await persistSyncPayload({
    prisma,
    cliTokenId: "cli-token-1",
    memberId: "member-1",
    payload,
  });

  expect(tx.dailyProviderUsage.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "usage-1" },
      data: expect.objectContaining({
        totalTokens: 150n,
        costUsd: "2.000000",
        sourceSnapshot: { totalTokens: 150, costUSD: 2 },
      }),
      select: { id: true },
    }),
  );
  expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalled();
});
```

Add a higher-total refresh test:

```ts
it("accepts a higher total and replaces model rows", async () => {
  const tx = createTransactionMock();
  tx.dailyProviderUsage.findUnique.mockResolvedValue({
    id: "usage-1",
    totalTokens: 100n,
  });
  const prisma = createPrismaMock(tx);
  const payload = createPayload({
    tokenCategories: { input: 200 },
    totalTokens: 200,
    models: [
      {
        modelName: "gpt-5.5",
        tokenCategories: { input: 200 },
        totalTokens: 200,
      },
    ],
  });

  await persistSyncPayload({
    prisma,
    cliTokenId: "cli-token-1",
    memberId: "member-1",
    payload,
  });

  expect(tx.dailyProviderUsage.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "usage-1" },
      data: expect.objectContaining({ totalTokens: 200n }),
      select: { id: true },
    }),
  );
  expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalled();
  expect(tx.dailyModelUsage.createMany).toHaveBeenCalled();
});
```

- [ ] **Step 4: Implement high-water persistence**

In `apps/web/src/server/sync-ingest.ts`, update the transaction type:

```ts
dailyProviderUsage: {
  findUnique(args: Prisma.DailyProviderUsageFindUniqueArgs): Promise<{ id: string; totalTokens: bigint } | null>;
  create(args: Prisma.DailyProviderUsageCreateArgs): Promise<{ id: string }>;
  update(args: Prisma.DailyProviderUsageUpdateArgs): Promise<{ id: string }>;
};
```

Add a helper near `nullableJson`:

```ts
function providerUsageData({
  memberId,
  deviceId,
  payload,
  date,
  syncedAt,
}: {
  memberId: string;
  deviceId: string;
  payload: SyncPayload;
  date: Date;
  syncedAt: Date;
}) {
  return {
    memberId,
    deviceId,
    provider: payload.provider,
    date,
    tokenCategories: payload.tokenCategories,
    tokenDetails: nullableJson(payload.tokenDetails),
    totalTokens: BigInt(payload.totalTokens),
    costUsd: decimalInput(payload.costUsd),
    costSource: payload.costSource ?? null,
    costMetadata: nullableJson(payload.costMetadata),
    sourceSnapshot: nullableJson(payload.sourceSnapshot),
    cliVersion: payload.cliVersion,
    ccusageVersion: payload.ccusageVersion,
    os: payload.os,
    syncedAt,
  };
}
```

Replace the existing `dailyProviderUsage.upsert` block with:

```ts
const usageKey = {
  deviceId_provider_date: {
    deviceId: device.id,
    provider: payload.provider,
    date,
  },
};
const incomingTotalTokens = BigInt(payload.totalTokens);
const existingUsage = await tx.dailyProviderUsage.findUnique({
  where: usageKey,
  select: { id: true, totalTokens: true },
});
const shouldAcceptSnapshot = !existingUsage || incomingTotalTokens >= existingUsage.totalTokens;
let usage: { id: string } | null = null;

if (!existingUsage) {
  usage = await tx.dailyProviderUsage.create({
    data: providerUsageData({ memberId, deviceId: device.id, payload, date, syncedAt }),
    select: { id: true },
  });
} else if (shouldAcceptSnapshot) {
  usage = await tx.dailyProviderUsage.update({
    where: { id: existingUsage.id },
    data: providerUsageData({ memberId, deviceId: device.id, payload, date, syncedAt }),
    select: { id: true },
  });
}
```

Wrap the existing model-row delete/create block in:

```ts
if (usage) {
  await tx.dailyModelUsage.deleteMany({
    where: {
      deviceId: device.id,
      provider: payload.provider,
      date,
    },
  });

  if (payload.models?.length) {
    await tx.dailyModelUsage.createMany({
      data: payload.models.map((model) => ({
        dailyProviderUsageId: usage.id,
        memberId,
        deviceId: device.id,
        provider: payload.provider,
        date,
        modelName: model.modelName,
        tokenCategories: model.tokenCategories,
        tokenDetails: nullableJson(model.tokenDetails),
        totalTokens: BigInt(model.totalTokens),
        costUsd: decimalInput(model.costUsd),
        metadata: nullableJson(model.metadata),
      })),
    });
  }
}
```

- [ ] **Step 5: Run ingest tests and verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-ingest.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit high-water ingest**

Run:

```bash
git add apps/web/src/server/sync-ingest.ts apps/web/src/server/sync-ingest.test.ts
git commit -m "fix(web): preserve high-water usage totals"
```

## Task 3: Server Sync-Window Helper

**Files:**
- Create: `apps/web/src/server/sync-windows.ts`
- Create: `apps/web/src/server/sync-windows.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `apps/web/src/server/sync-windows.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { buildSyncWindows, type SyncWindowsPrisma } from "./sync-windows";

describe("buildSyncWindows", () => {
  it("returns UTC until and provider-specific since dates", async () => {
    const prisma = createPrismaMock([
      { provider: "claude_code", _max: { syncedAt: new Date("2026-06-05T23:30:00.000Z") } },
      { provider: "codex", _max: { syncedAt: new Date("2026-06-06T01:15:00.000Z") } },
    ]);

    await expect(
      buildSyncWindows({
        prisma,
        memberId: "member-1",
        clientDeviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        now: () => new Date("2026-06-06T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [
        { provider: "claude_code", since: "2026-06-05" },
        { provider: "codex", since: "2026-06-06" },
      ],
    });
  });

  it("omits since for providers without rows", async () => {
    const prisma = createPrismaMock([
      { provider: "codex", _max: { syncedAt: new Date("2026-06-06T01:15:00.000Z") } },
    ]);

    await expect(
      buildSyncWindows({
        prisma,
        memberId: "member-1",
        clientDeviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        now: () => new Date("2026-06-06T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [{ provider: "claude_code" }, { provider: "codex", since: "2026-06-06" }],
    });
  });
});

function createPrismaMock(rows: Array<{ provider: string; _max: { syncedAt: Date | null } }>): SyncWindowsPrisma {
  return {
    dailyProviderUsage: {
      groupBy: vi.fn().mockResolvedValue(rows),
    },
  } as unknown as SyncWindowsPrisma;
}
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts
```

Expected: FAIL because `sync-windows.ts` does not exist.

- [ ] **Step 3: Implement sync-window helper**

Create `apps/web/src/server/sync-windows.ts`:

```ts
import { providers, type Provider, type SyncWindowsResponse } from "@token-burn/shared";
import type { Prisma } from "@prisma/client";

import { prisma as prismaClient } from "@/lib/prisma";

type ProviderWindowRow = {
  provider: string;
  _max: {
    syncedAt: Date | null;
  };
};

export type SyncWindowsPrisma = {
  dailyProviderUsage: {
    groupBy(args: Prisma.DailyProviderUsageGroupByArgs): Promise<ProviderWindowRow[]>;
  };
};

export async function buildSyncWindows({
  prisma = prismaClient as unknown as SyncWindowsPrisma,
  memberId,
  clientDeviceId,
  now = () => new Date(),
}: {
  prisma?: SyncWindowsPrisma;
  memberId: string;
  clientDeviceId: string;
  now?: () => Date;
}): Promise<SyncWindowsResponse> {
  const serverNow = now();
  const rows = await prisma.dailyProviderUsage.groupBy({
    by: ["provider"],
    where: {
      memberId,
      device: {
        clientDeviceId,
      },
    },
    _max: {
      syncedAt: true,
    },
  });
  const latestSyncedAtByProvider = new Map(
    rows.flatMap((row) => {
      if (!isProvider(row.provider) || !row._max.syncedAt) return [];
      return [[row.provider, row._max.syncedAt] as const];
    }),
  );

  return {
    serverTime: serverNow.toISOString(),
    until: toUtcDate(serverNow),
    providers: providers.map((provider) => {
      const syncedAt = latestSyncedAtByProvider.get(provider);
      return syncedAt ? { provider, since: toUtcDate(syncedAt) } : { provider };
    }),
  };
}

function isProvider(value: string): value is Provider {
  return (providers as readonly string[]).includes(value);
}

function toUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit sync-window helper**

Run:

```bash
git add apps/web/src/server/sync-windows.ts apps/web/src/server/sync-windows.test.ts
git commit -m "feat(web): compute server sync windows"
```

## Task 4: Sync-Window API Route

**Files:**
- Create: `apps/web/src/app/api/cli/sync-windows/route.ts`
- Create: `apps/web/src/app/api/cli/sync-windows/route.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/web/src/app/api/cli/sync-windows/route.test.ts`:

```ts
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";

import { GET } from "./route";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: {
      findFirst: vi.fn(),
    },
    dailyProviderUsage: {
      groupBy: vi.fn(),
    },
  },
}));

describe("GET /api/cli/sync-windows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(prisma.cliToken.findFirst).mockReset();
    vi.mocked(prisma.dailyProviderUsage.groupBy).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns provider sync windows for an authenticated CLI token", async () => {
    vi.setSystemTime(new Date("2026-06-06T12:00:00.000Z"));
    vi.mocked(prisma.cliToken.findFirst).mockResolvedValue({
      member: { id: "member-1" },
    } as never);
    vi.mocked(prisma.dailyProviderUsage.groupBy).mockResolvedValue([
      { provider: "codex", _max: { syncedAt: new Date("2026-06-06T01:15:00.000Z") } },
    ] as never);

    const response = await GET(
      request("https://token-burn.test/api/cli/sync-windows?deviceId=4f43b27d-7d86-4ff8-8c98-f74158819e59"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [{ provider: "claude_code" }, { provider: "codex", since: "2026-06-06" }],
    });
    expect(prisma.cliToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenHash: hashSecret("secret"),
          revokedAt: null,
        }),
      }),
    );
  });

  it("rejects missing auth", async () => {
    const response = await GET(
      new NextRequest("https://token-burn.test/api/cli/sync-windows?deviceId=4f43b27d-7d86-4ff8-8c98-f74158819e59"),
    );

    expect(response.status).toBe(401);
  });

  it("rejects invalid device IDs", async () => {
    vi.mocked(prisma.cliToken.findFirst).mockResolvedValue({
      member: { id: "member-1" },
    } as never);

    const response = await GET(request("https://token-burn.test/api/cli/sync-windows?deviceId=not-a-uuid"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid sync windows request" });
  });
});

function request(url: string): NextRequest {
  return new NextRequest(url, {
    headers: {
      authorization: "Bearer secret",
    },
  });
}
```

- [ ] **Step 2: Run route tests and verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/api/cli/sync-windows/route.test.ts
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route**

Create `apps/web/src/app/api/cli/sync-windows/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";
import { buildSyncWindows } from "@/server/sync-windows";

const querySchema = z.object({
  deviceId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const token = readBearerToken(request);
  if (!token) return unauthorized();

  const cliToken = await prisma.cliToken.findFirst({
    where: {
      tokenHash: hashSecret(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      member: { select: { id: true } },
    },
  });

  if (!cliToken) return unauthorized();

  const parsed = querySchema.safeParse({
    deviceId: request.nextUrl.searchParams.get("deviceId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync windows request" }, { status: 400 });
  }

  const windows = await buildSyncWindows({
    memberId: cliToken.member.id,
    clientDeviceId: parsed.data.deviceId,
  });

  return NextResponse.json(windows);
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

- [ ] **Step 4: Run route tests and verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/api/cli/sync-windows/route.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit sync-window route**

Run:

```bash
git add apps/web/src/app/api/cli/sync-windows/route.ts apps/web/src/app/api/cli/sync-windows/route.test.ts
git commit -m "feat(web): add sync windows endpoint"
```

## Task 5: CLI `ccusage` Date Windows

**Files:**
- Modify: `packages/cli/src/ccusage.ts`
- Modify: `packages/cli/src/ccusage.test.ts`

- [ ] **Step 1: Write failing date-window arg tests**

In `packages/cli/src/ccusage.test.ts`, add these tests inside `describe("buildCcusageArgs", ...)`:

```ts
it("adds YYYYMMDD since and until flags for Claude Code", () => {
  expect(buildCcusageArgs("claude_code", false, { since: "2026-06-05", until: "2026-06-06" })).toEqual([
    "claude",
    "daily",
    "--json",
    "--timezone",
    "UTC",
    "--since",
    "20260605",
    "--until",
    "20260606",
    "--breakdown",
  ]);
});

it("adds YYYYMMDD since and until flags for Codex", () => {
  expect(buildCcusageArgs("codex", false, { since: "2026-06-05", until: "2026-06-06" })).toEqual([
    "codex",
    "daily",
    "--json",
    "--timezone",
    "UTC",
    "--since",
    "20260605",
    "--until",
    "20260606",
  ]);
});
```

Add this test inside `describe("readProviderUsage", ...)`:

```ts
it("preserves date windows when Claude breakdown falls back", async () => {
  const runCommand = vi
    .fn()
    .mockRejectedValueOnce(new Error("breakdown unavailable"))
    .mockResolvedValueOnce({
      stdout: JSON.stringify([{ date: "2026-06-06", inputTokens: 10 }]),
      stderr: "",
    });

  await readProviderUsage("claude_code", {
    runCommand,
    window: { since: "2026-06-05", until: "2026-06-06" },
  });

  expect(runCommand.mock.calls[0]?.[1]).toEqual([
    "claude",
    "daily",
    "--json",
    "--timezone",
    "UTC",
    "--since",
    "20260605",
    "--until",
    "20260606",
    "--breakdown",
  ]);
  expect(runCommand.mock.calls[1]?.[1]).toEqual([
    "claude",
    "daily",
    "--json",
    "--timezone",
    "UTC",
    "--since",
    "20260605",
    "--until",
    "20260606",
  ]);
});
```

- [ ] **Step 2: Run ccusage tests and verify they fail**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ccusage.test.ts
```

Expected: FAIL because `buildCcusageArgs` and `readProviderUsage` do not accept a window.

- [ ] **Step 3: Implement date-window args**

In `packages/cli/src/ccusage.ts`, add:

```ts
export type ProviderUsageWindow = {
  since?: string;
  until: string;
};
```

Change the `readProviderUsage` signature to:

```ts
export async function readProviderUsage(
  provider: CcusageProvider,
  { runCommand = spawnCommand, window }: { runCommand?: CommandRunner; window?: ProviderUsageWindow } = {},
): Promise<NormalizedUsageRow[]> {
```

Change both `buildCcusageArgs` calls in `readProviderUsage`:

```ts
result = await runCommand("ccusage", buildCcusageArgs(provider, false, window));
```

and:

```ts
result = await runCommand("ccusage", buildCcusageArgs(provider, true, window));
```

Change `buildCcusageArgs`:

```ts
export function buildCcusageArgs(provider: CcusageProvider, fallback = false, window?: ProviderUsageWindow): string[] {
  const windowArgs = buildWindowArgs(window);

  if (provider === "claude_code") {
    const args = ["claude", "daily", "--json", "--timezone", "UTC", ...windowArgs];
    return fallback ? args : [...args, "--breakdown"];
  }

  return ["codex", "daily", "--json", "--timezone", "UTC", ...windowArgs];
}
```

Add:

```ts
function buildWindowArgs(window: ProviderUsageWindow | undefined): string[] {
  if (!window?.since) return [];

  return ["--since", compactIsoDate(window.since), "--until", compactIsoDate(window.until)];
}

function compactIsoDate(value: string): string {
  return value.replaceAll("-", "");
}
```

- [ ] **Step 4: Run ccusage tests and verify they pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ccusage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit ccusage date windows**

Run:

```bash
git add packages/cli/src/ccusage.ts packages/cli/src/ccusage.test.ts
git commit -m "feat(cli): pass sync windows to ccusage"
```

## Task 6: CLI Server-Directed Sync Flow

**Files:**
- Modify: `packages/cli/src/sync.ts`
- Modify: `packages/cli/src/sync.test.ts`

- [ ] **Step 1: Write failing server-window sync tests**

In `packages/cli/src/sync.test.ts`, add this helper near `matchingHealth`:

```ts
async function fullSyncWindows() {
  return {
    serverTime: "2026-06-06T12:00:00.000Z",
    until: "2026-06-06",
    providers: [{ provider: "claude_code" }, { provider: "codex" }],
  };
}
```

Add `getJson: fullSyncWindows,` to these existing `syncUsage` test dependency objects because they authenticate and reach provider collection:

- `"posts payloads and writes successful lastSync after a successful sync"`
- `"returns structured sync results after a successful sync"`
- `"reuses remembered device identity instead of creating a new one"`
- `"records skipped unsupported providers as a successful sync when supported providers submit"`
- `"records providers without local usage data as skipped instead of failed"`
- `"records actual provider failures as failed even when another provider submits"`
- `"explains ccusage native binary chmod failures without suggesting sudo sync"`
- `"writes failed lastSync before throwing when supported providers fail and unsupported providers are skipped"`

Each listed test should include:

```ts
getJson: fullSyncWindows,
```

For the first successful sync test, update the write assertion from one write to two writes:

```ts
expect(writes).toEqual([
  {
    serverUrl: "https://token-burn.test",
    token: "secret",
    deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
    deviceName: "nayan-vps",
  },
  {
    serverUrl: "https://token-burn.test",
    token: "secret",
    deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
    deviceName: "nayan-vps",
    lastSync: {
      ok: true,
      message: "Submitted 2 usage rows.",
      at: "2026-06-01T00:00:00.000Z",
    },
  },
]);
```

Then add this new test inside `describe("syncUsage", ...)`:

```ts
it("fetches server sync windows and passes provider windows to ccusage", async () => {
  const readProviderUsageCalls: Array<{ provider: string; window: unknown }> = [];
  const getCalls: Array<{ url: string; token?: string }> = [];
  const posts: Array<{ url: string; body: unknown; token?: string }> = [];

  await syncUsage({
    readConfig: async () => ({
      serverUrl: "https://token-burn.test",
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
    }),
    writeConfig: async () => {},
    getJson: async (url, token) => {
      getCalls.push({ url, token });
      return {
        serverTime: "2026-06-06T12:00:00.000Z",
        until: "2026-06-06",
        providers: [
          { provider: "claude_code", since: "2026-06-05" },
          { provider: "codex", since: "2026-06-06" },
        ],
      };
    },
    postJson: async (url, body, token) => {
      posts.push({ url, body, token });
      return { ok: true };
    },
    readHealth: matchingHealth,
    readProviderUsage: async (provider, options) => {
      readProviderUsageCalls.push({ provider, window: options?.window });
      return [{ provider, date: "2026-06-06", tokenCategories: { input: 10 }, totalTokens: 10 }];
    },
    readCcusageVersion: async () => "16.2.5",
    now: () => new Date("2026-06-06T12:30:00.000Z"),
    platform: "linux",
    cliVersion: "0.1.0",
    readDeviceName: () => "nayan-vps",
    log: () => {},
  });

  expect(getCalls).toEqual([
    {
      url: "https://token-burn.test/api/cli/sync-windows?deviceId=4f43b27d-7d86-4ff8-8c98-f74158819e59",
      token: "secret",
    },
  ]);
  expect(readProviderUsageCalls).toEqual([
    { provider: "claude_code", window: { since: "2026-06-05", until: "2026-06-06" } },
    { provider: "codex", window: { since: "2026-06-06", until: "2026-06-06" } },
  ]);
  expect(posts).toHaveLength(2);
});
```

Add a full-history missing-since test:

```ts
it("does full-history collection when the server omits provider since", async () => {
  const windows: unknown[] = [];

  await syncUsage({
    readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
    writeConfig: async () => {},
    getJson: async () => ({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [{ provider: "claude_code" }, { provider: "codex", since: "2026-06-06" }],
    }),
    postJson: async () => ({ ok: true }),
    readHealth: matchingHealth,
    readProviderUsage: async (provider, options) => {
      windows.push(options?.window);
      return provider === "claude_code"
        ? [{ provider, date: "2026-05-31", tokenCategories: { input: 10 }, totalTokens: 10 }]
        : [];
    },
    readCcusageVersion: async () => "16.2.5",
    now: () => new Date("2026-06-06T12:30:00.000Z"),
    platform: "linux",
    cliVersion: "0.1.0",
    createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
    readDeviceName: () => "nayan-vps",
    log: () => {},
  });

  expect(windows).toEqual([undefined, { since: "2026-06-06", until: "2026-06-06" }]);
});
```

Add an unknown-provider ignore test:

```ts
it("ignores unknown provider windows from the server", async () => {
  const providers: string[] = [];

  await syncUsage({
    readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
    writeConfig: async () => {},
    getJson: async () => ({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: [
        { provider: "other_provider", since: "2026-06-06" },
        { provider: "codex", since: "2026-06-06" },
      ],
    }),
    postJson: async () => ({ ok: true }),
    readHealth: matchingHealth,
    readProviderUsage: async (provider) => {
      providers.push(provider);
      return [];
    },
    readCcusageVersion: async () => "16.2.5",
    now: () => new Date("2026-06-06T12:30:00.000Z"),
    platform: "linux",
    cliVersion: "0.1.0",
    createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
    readDeviceName: () => "nayan-vps",
    log: () => {},
  });

  expect(providers).toEqual(["claude_code", "codex"]);
});
```

- [ ] **Step 2: Run sync tests and verify they fail**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts
```

Expected: FAIL because `syncUsage` does not have `getJson` and does not pass provider windows.

- [ ] **Step 3: Implement server-window sync flow**

In `packages/cli/src/sync.ts`, import `getJson` and sync-window types:

```ts
import { syncPayloadSchema, syncWindowsResponseSchema, type Provider, type SyncPayload } from "@token-burn/shared";
import { getJson as getJsonRequest, postJson as postJsonRequest } from "./http.js";
```

Update `SyncDependencies`:

```ts
getJson?: <T>(url: string, token?: string) => Promise<T>;
readProviderUsage?: (provider: Provider, options?: { window?: ProviderUsageWindow }) => Promise<NormalizedUsageRow[]>;
```

Add `getJson = getJsonRequest` to `syncUsage` dependencies.

Move device ID creation before reading sync windows:

```ts
const deviceId = config.deviceId ?? createDeviceId();
const deviceName = normalizeDeviceName(readDeviceName());
const configWithDevice = { ...config, deviceId, deviceName };
await writeConfig(configWithDevice);
```

Fetch windows after reading `ccusageVersion` and before the provider loop:

```ts
const syncWindows = await readSyncWindows({ getJson, serverUrl: config.serverUrl, token: config.token, deviceId });
const providerWindows = new Map(syncWindows.providers.map((window) => [window.provider, window]));
```

In the provider loop, call:

```ts
const providerWindow = providerWindows.get(provider);
const rows = await readProviderUsage(provider, {
  window: providerWindow?.since ? { since: providerWindow.since, until: syncWindows.until } : undefined,
});
```

Add helper:

```ts
async function readSyncWindows({
  getJson,
  serverUrl,
  token,
  deviceId,
}: {
  getJson: <T>(url: string, token?: string) => Promise<T>;
  serverUrl: string;
  token: string;
  deviceId: string;
}) {
  const url = `${serverUrl.replace(/\/+$/, "")}/api/cli/sync-windows?deviceId=${encodeURIComponent(deviceId)}`;
  const response = await getJson<unknown>(url, token);
  return syncWindowsResponseSchema.parse(response);
}
```

Preserve the final `writeConfig({ ...configWithDevice, lastSync })` so the earlier write is updated with sync status.

- [ ] **Step 4: Run sync tests and verify they pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit CLI sync-window flow**

Run:

```bash
git add packages/cli/src/sync.ts packages/cli/src/sync.test.ts
git commit -m "feat(cli): use server-directed sync windows"
```

## Task 7: Final Verification

**Files:**
- Modify only if verification exposes a defect in earlier tasks.

- [ ] **Step 1: Run targeted package tests**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
pnpm --filter @token-burn/web test -- src/server/sync-ingest.test.ts src/server/sync-windows.test.ts src/app/api/cli/sync-windows/route.test.ts
pnpm --filter @blnayan/token-burn test -- src/ccusage.test.ts src/sync.test.ts
```

Expected: PASS for all commands.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Inspect git history and worktree**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: `git status --short` prints nothing. The recent log includes the focused commits from Tasks 1 through 6.
