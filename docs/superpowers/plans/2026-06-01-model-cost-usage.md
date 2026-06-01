# Model and Cost Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store aggregate daily model and cost usage from `ccusage` while preserving Token Burn's privacy boundary.

**Architecture:** Extend the shared sync payload with optional cost, model rows, and non-scoring token details. The CLI normalizes richer `ccusage` daily JSON and submits it. The web API validates the extended payload, upserts the parent daily provider row, and replaces child daily model rows for idempotent sync.

**Tech Stack:** TypeScript, Zod 4, Vitest, Prisma 7, Next.js route handlers, PostgreSQL JSONB and Decimal columns, `ccusage`.

---

## File Structure

- Modify `packages/shared/src/schemas.ts`: add reusable cost, token detail, and model usage schemas.
- Modify `packages/shared/src/schemas.test.ts`: cover extended sync payload validation and backward compatibility.
- Modify `packages/cli/src/ccusage.ts`: normalize `costUSD`, `models`, and `reasoningOutputTokens` from `ccusage`.
- Modify `packages/cli/src/ccusage.test.ts`: cover richer Codex JSON, Claude breakdown args, and fallback behavior.
- Modify `packages/cli/src/sync.ts`: include the richer normalized usage data in the sync payload.
- Modify `packages/cli/src/sync.test.ts`: assert sync posts cost, model rows, and token details.
- Modify `apps/web/prisma/schema.prisma`: add parent cost/detail fields and `DailyModelUsage`.
- Create `apps/web/prisma/migrations/20260601120000_model_cost_usage/migration.sql`: add database columns, table, indexes, and foreign keys.
- Create `apps/web/src/server/sync-ingest.ts`: move validated persistence into a testable server helper.
- Create `apps/web/src/server/sync-ingest.test.ts`: test cost/model persistence with mocked Prisma transaction methods.
- Modify `apps/web/src/app/api/sync/route.ts`: call the new persistence helper.
- Modify `vitest.config.ts`: add `@/` alias so web server helpers imported by route tests resolve under Vitest.

Implementation should happen in a clean worktree or an isolated git worktree. The current repository may contain unrelated local changes, so each task stages only the files listed in that task.

---

### Task 1: Extend Shared Sync Schema

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add these cases inside `describe("syncPayloadSchema", ...)` in `packages/shared/src/schemas.test.ts`:

```ts
  it("accepts cost, token details, and model usage rows", () => {
    const payload = syncPayloadSchema.parse({
      provider: "codex",
      date: "2026-06-01",
      tokenCategories: {
        input: 100,
        output: 50,
        cacheCreate: 0,
        cacheRead: 850,
      },
      tokenDetails: {
        reasoningOutput: 20,
      },
      totalTokens: 1000,
      costUsd: 1.234567,
      costSource: "ccusage",
      costMetadata: {
        speed: "fast",
      },
      sourceSnapshot: {
        costUSD: 1.234567,
        totalTokens: 1000,
      },
      models: [
        {
          modelName: "gpt-5.5",
          tokenCategories: {
            input: 100,
            output: 50,
            cacheCreate: 0,
            cacheRead: 850,
          },
          tokenDetails: {
            reasoningOutput: 20,
          },
          totalTokens: 1000,
          costUsd: 1.234567,
          metadata: {
            isFallback: false,
          },
        },
      ],
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(payload.costUsd).toBe(1.234567);
    expect(payload.tokenDetails?.reasoningOutput).toBe(20);
    expect(payload.models?.[0]?.modelName).toBe("gpt-5.5");
  });

  it("rejects negative cost and model totals that do not match scoring categories", () => {
    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-06-01",
        tokenCategories: { input: 100 },
        totalTokens: 100,
        costUsd: -1,
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "20.0.6",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      syncPayloadSchema.parse({
        provider: "codex",
        date: "2026-06-01",
        tokenCategories: { input: 100 },
        totalTokens: 100,
        models: [
          {
            modelName: "gpt-5.5",
            tokenCategories: { input: 100 },
            totalTokens: 101,
          },
        ],
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "20.0.6",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toThrow("model totalTokens must equal the sum of tokenCategories");
  });

  it("keeps reasoning output out of scoring token totals", () => {
    const payload = syncPayloadSchema.parse({
      provider: "codex",
      date: "2026-06-01",
      tokenCategories: {
        input: 10,
        output: 20,
      },
      tokenDetails: {
        reasoningOutput: 7,
      },
      totalTokens: 30,
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(payload.totalTokens).toBe(30);
    expect(payload.tokenDetails).toEqual({ reasoningOutput: 7 });
  });
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: FAIL because `costUsd`, `tokenDetails`, and `models` are not part of `syncPayloadSchema`.

- [ ] **Step 3: Implement the extended schema**

Update `packages/shared/src/schemas.ts` with these reusable schemas above `syncPayloadSchema`:

```ts
const costUsdSchema = z.number().finite().nonnegative().max(1_000_000);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const tokenDetailsSchema = z.record(z.string(), z.number().int().nonnegative().safe());

export const syncModelUsageSchema = z
  .object({
    modelName: z.string().trim().min(1).max(160),
    tokenCategories: tokenCategoriesSchema,
    tokenDetails: tokenDetailsSchema.optional(),
    totalTokens: z.number().int().nonnegative().safe(),
    costUsd: costUsdSchema.optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .refine((model) => model.totalTokens === sumTokenCategories(model.tokenCategories), {
    message: "model totalTokens must equal the sum of tokenCategories",
    path: ["totalTokens"],
  });

export type SyncModelUsage = z.infer<typeof syncModelUsageSchema>;
```

Extend `syncPayloadSchema`:

```ts
export const syncPayloadSchema = z
  .object({
    provider: providerSchema,
    date: isoDateSchema,
    tokenCategories: tokenCategoriesSchema,
    tokenDetails: tokenDetailsSchema.optional(),
    totalTokens: z.number().int().nonnegative().safe(),
    costUsd: costUsdSchema.optional(),
    costSource: z.literal("ccusage").optional(),
    costMetadata: jsonObjectSchema.optional(),
    sourceSnapshot: jsonObjectSchema.optional(),
    models: z.array(syncModelUsageSchema).max(500).optional(),
    deviceId: z.string().uuid(),
    deviceName: z.string().trim().min(1).max(80),
    cliVersion: z.string().min(1),
    ccusageVersion: z.string().min(1),
    os: z.enum(["darwin", "linux", "win32"]),
    syncedAt: z.string().datetime(),
  })
  .refine((payload) => payload.totalTokens === sumTokenCategories(payload.tokenCategories), {
    message: "totalTokens must equal the sum of tokenCategories",
    path: ["totalTokens"],
  });
```

- [ ] **Step 4: Run schema tests and verify they pass**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared schema work**

Run:

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat(shared): accept model and cost sync payloads"
```

---

### Task 2: Normalize Model and Cost Data in the CLI

**Files:**
- Modify: `packages/cli/src/ccusage.ts`
- Modify: `packages/cli/src/ccusage.test.ts`

- [ ] **Step 1: Write failing ccusage normalization tests**

Add tests in `packages/cli/src/ccusage.test.ts`:

```ts
  it("normalizes Codex cost, model usage, and reasoning token details", () => {
    const rows = normalizeCcusageDailyRows("codex", [
      {
        cachedInputTokens: 850,
        costUSD: 1.234567,
        date: "2026-06-01",
        inputTokens: 100,
        models: {
          "gpt-5.5": {
            cachedInputTokens: 850,
            inputTokens: 100,
            isFallback: false,
            outputTokens: 50,
            reasoningOutputTokens: 20,
            totalTokens: 1000,
          },
        },
        outputTokens: 50,
        reasoningOutputTokens: 20,
        totalTokens: 1000,
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "codex",
        date: "2026-06-01",
        tokenCategories: {
          input: 100,
          output: 50,
          cacheCreate: 0,
          cacheRead: 850,
        },
        tokenDetails: {
          reasoningOutput: 20,
        },
        totalTokens: 1000,
        costUsd: 1.234567,
        costSource: "ccusage",
        sourceSnapshot: {
          cachedInputTokens: 850,
          costUSD: 1.234567,
          inputTokens: 100,
          outputTokens: 50,
          reasoningOutputTokens: 20,
          totalTokens: 1000,
        },
        models: [
          {
            modelName: "gpt-5.5",
            tokenCategories: {
              input: 100,
              output: 50,
              cacheCreate: 0,
              cacheRead: 850,
            },
            tokenDetails: {
              reasoningOutput: 20,
            },
            totalTokens: 1000,
            metadata: {
              isFallback: false,
            },
          },
        ],
      },
    ]);
  });

  it("uses Claude breakdown first and falls back to standard daily args", async () => {
    const runCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("breakdown unavailable"))
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            date: "2026-06-01",
            inputTokens: 10,
          },
        ]),
        stderr: "",
      });

    await expect(readProviderUsage("claude_code", { runCommand })).resolves.toMatchObject([
      {
        provider: "claude_code",
        date: "2026-06-01",
        totalTokens: 10,
      },
    ]);

    expect(runCommand.mock.calls[0]?.[1]).toEqual(["claude", "daily", "--json", "--timezone", "UTC", "--breakdown"]);
    expect(runCommand.mock.calls[1]?.[1]).toEqual(["claude", "daily", "--json", "--timezone", "UTC"]);
  });
```

Update the existing Claude args expectation to include `--breakdown` for the primary command:

```ts
expect(buildCcusageArgs("claude_code")).toEqual(["claude", "daily", "--json", "--timezone", "UTC", "--breakdown"]);
```

- [ ] **Step 2: Run CLI ccusage tests and verify they fail**

Run:

```bash
pnpm --filter token-burn test -- src/ccusage.test.ts
```

Expected: FAIL because `NormalizedUsageRow` does not expose model or cost fields and Claude does not use `--breakdown`.

- [ ] **Step 3: Implement richer normalized types**

Update the top of `packages/cli/src/ccusage.ts`:

```ts
export type NormalizedModelUsage = {
  modelName: string;
  tokenCategories: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
  };
  tokenDetails?: {
    reasoningOutput: number;
  };
  totalTokens: number;
  costUsd?: number;
  metadata?: Record<string, unknown>;
};

export type NormalizedUsageRow = {
  provider: Provider;
  date: string;
  tokenCategories: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
  };
  tokenDetails?: {
    reasoningOutput: number;
  };
  totalTokens: number;
  costUsd?: number;
  costSource?: "ccusage";
  costMetadata?: Record<string, unknown>;
  sourceSnapshot?: Record<string, unknown>;
  models?: NormalizedModelUsage[];
};
```

- [ ] **Step 4: Implement normalization helpers**

Add these helpers near the existing token field helpers:

```ts
const tokenDetailAliases = {
  reasoningOutput: ["reasoningOutputTokens", "reasoning_output_tokens", "reasoning"],
} as const;

function readOptionalTokenDetails(record: Record<string, unknown>): { reasoningOutput: number } | undefined {
  const reasoningOutput = readTokenField(record, tokenDetailAliases.reasoningOutput);
  return reasoningOutput > 0 ? { reasoningOutput } : undefined;
}

function readOptionalCostUsd(record: Record<string, unknown>): number | undefined {
  const value = record.costUSD ?? record.costUsd ?? record.totalCost;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error("ccusage daily row has an invalid cost value.");
  }
  return value;
}

function readTotalTokens(record: Record<string, unknown>, tokenCategories: NormalizedUsageRow["tokenCategories"]): number {
  const value = record.totalTokens ?? record.total_tokens;
  if (value === undefined) return sumTokenCategories(tokenCategories);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("ccusage daily row has an invalid totalTokens value.");
  }
  return Math.trunc(value);
}

function sanitizeSourceSnapshot(record: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys = [
    "cachedInputTokens",
    "cacheCreationTokens",
    "cacheReadTokens",
    "costUSD",
    "inputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalCost",
    "totalTokens",
  ];
  return Object.fromEntries(allowedKeys.flatMap((key) => (record[key] === undefined ? [] : [[key, record[key]]])));
}
```

Add model normalization:

```ts
function normalizeModelUsage(models: unknown): NormalizedModelUsage[] | undefined {
  if (models === undefined || models === null) return undefined;
  const record = toRecord(models);
  const rows = Object.entries(record).map(([modelName, value]) => {
    const modelRecord = toRecord(value);
    const tokenCategories = {
      input: readTokenField(modelRecord, tokenFieldAliases.input),
      output: readTokenField(modelRecord, tokenFieldAliases.output),
      cacheCreate: readTokenField(modelRecord, tokenFieldAliases.cacheCreate),
      cacheRead: readTokenField(modelRecord, tokenFieldAliases.cacheRead),
    };
    const tokenDetails = readOptionalTokenDetails(modelRecord);
    const costUsd = readOptionalCostUsd(modelRecord);
    const metadata =
      typeof modelRecord.isFallback === "boolean" ? { isFallback: modelRecord.isFallback } : undefined;

    return {
      modelName,
      tokenCategories,
      ...(tokenDetails ? { tokenDetails } : {}),
      totalTokens: readTotalTokens(modelRecord, tokenCategories),
      ...(costUsd === undefined ? {} : { costUsd }),
      ...(metadata ? { metadata } : {}),
    };
  });

  return rows.length === 0 ? undefined : rows.sort((a, b) => a.modelName.localeCompare(b.modelName));
}
```

- [ ] **Step 5: Use helpers in normalization and args**

Update `normalizeCcusageDailyRows`:

```ts
export function normalizeCcusageDailyRows(provider: Provider, rows: unknown[]): NormalizedUsageRow[] {
  return rows.map((row) => {
    const record = toRecord(row);
    const tokenCategories = {
      input: readTokenField(record, tokenFieldAliases.input),
      output: readTokenField(record, tokenFieldAliases.output),
      cacheCreate: readTokenField(record, tokenFieldAliases.cacheCreate),
      cacheRead: readTokenField(record, tokenFieldAliases.cacheRead),
    };
    const tokenDetails = readOptionalTokenDetails(record);
    const costUsd = readOptionalCostUsd(record);
    const sourceSnapshot = sanitizeSourceSnapshot(record);
    const models = normalizeModelUsage(record.models);

    return {
      provider,
      date: readDate(record),
      tokenCategories,
      ...(tokenDetails ? { tokenDetails } : {}),
      totalTokens: readTotalTokens(record, tokenCategories),
      ...(costUsd === undefined ? {} : { costUsd, costSource: "ccusage" as const }),
      ...(Object.keys(sourceSnapshot).length > 0 ? { sourceSnapshot } : {}),
      ...(models ? { models } : {}),
    };
  });
}
```

Update `buildCcusageArgs` and `readProviderUsage`:

```ts
export function buildCcusageArgs(provider: CcusageProvider, fallback = false): string[] {
  if (provider === "claude_code") {
    const args = ["claude", "daily", "--json", "--timezone", "UTC"];
    return fallback ? args : [...args, "--breakdown"];
  }

  return ["codex", "daily", "--json", "--timezone", "UTC"];
}

export async function readProviderUsage(
  provider: CcusageProvider,
  { runCommand = spawnCommand }: { runCommand?: CommandRunner } = {},
): Promise<NormalizedUsageRow[]> {
  const command = resolveCcusageCommand();

  try {
    const result = await runCommand(command, buildCcusageArgs(provider));
    const parsed = JSON.parse(result.stdout) as unknown;
    const rows = Array.isArray(parsed) ? parsed : readDailyArray(parsed);
    return normalizeCcusageDailyRows(provider, rows);
  } catch (error) {
    if (provider !== "claude_code") throw error;
    const result = await runCommand(command, buildCcusageArgs(provider, true));
    const parsed = JSON.parse(result.stdout) as unknown;
    const rows = Array.isArray(parsed) ? parsed : readDailyArray(parsed);
    return normalizeCcusageDailyRows(provider, rows);
  }
}
```

- [ ] **Step 6: Run CLI ccusage tests and verify they pass**

Run:

```bash
pnpm --filter token-burn test -- src/ccusage.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit CLI normalization**

Run:

```bash
git add packages/cli/src/ccusage.ts packages/cli/src/ccusage.test.ts
git commit -m "feat(cli): normalize model and cost usage"
```

---

### Task 3: Send Extended Data in Sync Payloads

**Files:**
- Modify: `packages/cli/src/sync.ts`
- Modify: `packages/cli/src/sync.test.ts`

- [ ] **Step 1: Write failing sync payload test**

In `packages/cli/src/sync.test.ts`, extend the successful sync test's fake usage row with cost/model data:

```ts
{
  provider,
  date: "2026-05-31",
  tokenCategories: { input: provider === "codex" ? 100 : 50, output: 25, cacheCreate: 0, cacheRead: 0 },
  tokenDetails: provider === "codex" ? { reasoningOutput: 5 } : undefined,
  totalTokens: provider === "codex" ? 125 : 75,
  costUsd: provider === "codex" ? 0.123456 : undefined,
  costSource: provider === "codex" ? "ccusage" : undefined,
  sourceSnapshot: provider === "codex" ? { costUSD: 0.123456, totalTokens: 125 } : undefined,
  models:
    provider === "codex"
      ? [
          {
            modelName: "gpt-5.5",
            tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
            tokenDetails: { reasoningOutput: 5 },
            totalTokens: 125,
            metadata: { isFallback: false },
          },
        ]
      : undefined,
}
```

Update the expected Codex post body to include:

```ts
tokenDetails: { reasoningOutput: 5 },
costUsd: 0.123456,
costSource: "ccusage",
sourceSnapshot: { costUSD: 0.123456, totalTokens: 125 },
models: [
  {
    modelName: "gpt-5.5",
    tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
    tokenDetails: { reasoningOutput: 5 },
    totalTokens: 125,
    metadata: { isFallback: false },
  },
],
```

- [ ] **Step 2: Run sync tests and verify they fail**

Run:

```bash
pnpm --filter token-burn test -- src/sync.test.ts
```

Expected: FAIL because `buildPayload` currently omits extended fields.

- [ ] **Step 3: Pass extended normalized row fields into the payload**

Update `buildPayload` in `packages/cli/src/sync.ts`:

```ts
function buildPayload(
  row: NormalizedUsageRow,
  metadata: {
    cliVersion: string;
    ccusageVersion: string;
    deviceId: string;
    deviceName: string;
    platform: SyncPlatform;
    syncedAt: string;
  },
): SyncPayload {
  return syncPayloadSchema.parse({
    provider: row.provider,
    date: row.date,
    tokenCategories: row.tokenCategories,
    ...(row.tokenDetails ? { tokenDetails: row.tokenDetails } : {}),
    totalTokens: row.totalTokens,
    ...(row.costUsd === undefined ? {} : { costUsd: row.costUsd }),
    ...(row.costSource ? { costSource: row.costSource } : {}),
    ...(row.costMetadata ? { costMetadata: row.costMetadata } : {}),
    ...(row.sourceSnapshot ? { sourceSnapshot: row.sourceSnapshot } : {}),
    ...(row.models ? { models: row.models } : {}),
    deviceId: metadata.deviceId,
    deviceName: metadata.deviceName,
    cliVersion: metadata.cliVersion,
    ccusageVersion: metadata.ccusageVersion,
    os: metadata.platform,
    syncedAt: metadata.syncedAt,
  });
}
```

- [ ] **Step 4: Run sync tests and verify they pass**

Run:

```bash
pnpm --filter token-burn test -- src/sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit sync payload changes**

Run:

```bash
git add packages/cli/src/sync.ts packages/cli/src/sync.test.ts
git commit -m "feat(cli): submit model and cost payload fields"
```

---

### Task 4: Add Prisma Schema and Migration

**Files:**
- Modify: `apps/web/prisma/schema.prisma`
- Create: `apps/web/prisma/migrations/20260601120000_model_cost_usage/migration.sql`

- [ ] **Step 1: Update Prisma schema**

Add relations to `Member`:

```prisma
  modelUsage       DailyModelUsage[]
```

Add relations to `Device`:

```prisma
  modelUsage     DailyModelUsage[]
```

Add fields and relation to `DailyProviderUsage`:

```prisma
  costUsd         Decimal? @db.Decimal(18, 6)
  costSource      String?
  costMetadata    Json?
  tokenDetails    Json?
  sourceSnapshot  Json?
  models          DailyModelUsage[]
```

Add the new model:

```prisma
model DailyModelUsage {
  id                   String             @id @default(cuid())
  dailyProviderUsageId String
  memberId             String
  deviceId             String
  provider             String
  date                 DateTime           @db.Date
  modelName            String
  tokenCategories      Json
  tokenDetails         Json?
  totalTokens          BigInt
  costUsd              Decimal?           @db.Decimal(18, 6)
  metadata             Json?
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
  dailyProviderUsage   DailyProviderUsage @relation(fields: [dailyProviderUsageId], references: [id], onDelete: Cascade)
  member               Member             @relation(fields: [memberId], references: [id], onDelete: Cascade)
  device               Device             @relation(fields: [deviceId], references: [id], onDelete: Cascade)

  @@unique([deviceId, provider, date, modelName])
  @@index([memberId, date])
  @@index([provider, modelName, date])
}
```

- [ ] **Step 2: Create migration SQL**

Create `apps/web/prisma/migrations/20260601120000_model_cost_usage/migration.sql`:

```sql
ALTER TABLE "DailyProviderUsage"
  ADD COLUMN "costUsd" DECIMAL(18,6),
  ADD COLUMN "costSource" TEXT,
  ADD COLUMN "costMetadata" JSONB,
  ADD COLUMN "tokenDetails" JSONB,
  ADD COLUMN "sourceSnapshot" JSONB;

CREATE TABLE "DailyModelUsage" (
  "id" TEXT NOT NULL,
  "dailyProviderUsageId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "modelName" TEXT NOT NULL,
  "tokenCategories" JSONB NOT NULL,
  "tokenDetails" JSONB,
  "totalTokens" BIGINT NOT NULL,
  "costUsd" DECIMAL(18,6),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DailyModelUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyModelUsage_deviceId_provider_date_modelName_key"
  ON "DailyModelUsage"("deviceId", "provider", "date", "modelName");

CREATE INDEX "DailyModelUsage_memberId_date_idx"
  ON "DailyModelUsage"("memberId", "date");

CREATE INDEX "DailyModelUsage_provider_modelName_date_idx"
  ON "DailyModelUsage"("provider", "modelName", "date");

ALTER TABLE "DailyModelUsage"
  ADD CONSTRAINT "DailyModelUsage_dailyProviderUsageId_fkey"
  FOREIGN KEY ("dailyProviderUsageId") REFERENCES "DailyProviderUsage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyModelUsage"
  ADD CONSTRAINT "DailyModelUsage_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyModelUsage"
  ADD CONSTRAINT "DailyModelUsage_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
pnpm --filter @token-burn/web db:generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 4: Run web typecheck**

Run:

```bash
pnpm --filter @token-burn/web typecheck
```

Expected: PASS or existing unrelated type errors. If there are existing unrelated errors, capture them in the task handoff before continuing.

- [ ] **Step 5: Commit Prisma changes**

Run:

```bash
git add apps/web/prisma/schema.prisma apps/web/prisma/migrations/20260601120000_model_cost_usage/migration.sql
git commit -m "feat(web): add model and cost usage tables"
```

---

### Task 5: Persist Model and Cost Usage in the Web API

**Files:**
- Modify: `vitest.config.ts`
- Create: `apps/web/src/server/sync-ingest.ts`
- Create: `apps/web/src/server/sync-ingest.test.ts`
- Modify: `apps/web/src/app/api/sync/route.ts`

- [ ] **Step 1: Add Vitest alias support for web imports**

Modify `vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      "@token-burn/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    globals: false,
    include: ["src/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write failing persistence tests**

Create `apps/web/src/server/sync-ingest.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { persistSyncPayload } from "./sync-ingest";

describe("persistSyncPayload", () => {
  it("upserts daily provider cost fields and replaces daily model rows", async () => {
    const tx = {
      device: {
        upsert: vi.fn().mockResolvedValue({ id: "device-db-id" }),
      },
      dailyProviderUsage: {
        upsert: vi.fn().mockResolvedValue({ id: "usage-db-id" }),
      },
      dailyModelUsage: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      cliToken: {
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    };

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-id",
      memberId: "member-id",
      payload: {
        provider: "codex",
        date: "2026-06-01",
        tokenCategories: { input: 100, output: 50, cacheCreate: 0, cacheRead: 850 },
        tokenDetails: { reasoningOutput: 20 },
        totalTokens: 1000,
        costUsd: 1.234567,
        costSource: "ccusage",
        costMetadata: { speed: "fast" },
        sourceSnapshot: { costUSD: 1.234567, totalTokens: 1000 },
        models: [
          {
            modelName: "gpt-5.5",
            tokenCategories: { input: 100, output: 50, cacheCreate: 0, cacheRead: 850 },
            tokenDetails: { reasoningOutput: 20 },
            totalTokens: 1000,
            costUsd: 1.234567,
            metadata: { isFallback: false },
          },
        ],
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "20.0.6",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(tx.dailyProviderUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          costUsd: "1.234567",
          costSource: "ccusage",
          tokenDetails: { reasoningOutput: 20 },
        }),
        update: expect.objectContaining({
          costUsd: "1.234567",
          costSource: "ccusage",
          tokenDetails: { reasoningOutput: 20 },
        }),
      }),
    );
    expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalledWith({
      where: {
        deviceId: "device-db-id",
        provider: "codex",
        date: new Date("2026-06-01T00:00:00.000Z"),
      },
    });
    expect(tx.dailyModelUsage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          dailyProviderUsageId: "usage-db-id",
          memberId: "member-id",
          deviceId: "device-db-id",
          modelName: "gpt-5.5",
          costUsd: "1.234567",
        }),
      ],
    });
  });

  it("clears stale model rows when a payload has no models", async () => {
    const tx = {
      device: {
        upsert: vi.fn().mockResolvedValue({ id: "device-db-id" }),
      },
      dailyProviderUsage: {
        upsert: vi.fn().mockResolvedValue({ id: "usage-db-id" }),
      },
      dailyModelUsage: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      cliToken: {
        update: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
    };

    await persistSyncPayload({
      prisma,
      cliTokenId: "cli-token-id",
      memberId: "member-id",
      payload: {
        provider: "claude_code",
        date: "2026-06-01",
        tokenCategories: { input: 10 },
        totalTokens: 10,
        deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
        deviceName: "nayan-vps",
        cliVersion: "0.1.0",
        ccusageVersion: "20.0.6",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(tx.dailyModelUsage.deleteMany).toHaveBeenCalledOnce();
    expect(tx.dailyModelUsage.createMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run persistence tests and verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-ingest.test.ts
```

Expected: FAIL because `sync-ingest.ts` does not exist.

- [ ] **Step 4: Implement sync persistence helper**

Create `apps/web/src/server/sync-ingest.ts`:

```ts
import { Prisma } from "@prisma/client";
import type { SyncPayload } from "@token-burn/shared";

import { prisma as prismaClient } from "@/lib/prisma";

type SyncIngestPrisma = Pick<typeof prismaClient, "$transaction">;

export type PersistSyncPayloadOptions = {
  prisma?: SyncIngestPrisma;
  cliTokenId: string;
  memberId: string;
  payload: SyncPayload;
};

export async function persistSyncPayload({
  prisma = prismaClient,
  cliTokenId,
  memberId,
  payload,
}: PersistSyncPayloadOptions): Promise<void> {
  const date = parseUtcDate(payload.date);
  const syncedAt = new Date(payload.syncedAt);

  await prisma.$transaction(async (tx) => {
    const device = await tx.device.upsert({
      where: {
        memberId_clientDeviceId: {
          memberId,
          clientDeviceId: payload.deviceId,
        },
      },
      create: {
        memberId,
        clientDeviceId: payload.deviceId,
        name: payload.deviceName,
        os: payload.os,
        lastSeenAt: syncedAt,
      },
      update: {
        name: payload.deviceName,
        os: payload.os,
        lastSeenAt: syncedAt,
      },
      select: { id: true },
    });

    const usage = await tx.dailyProviderUsage.upsert({
      where: {
        deviceId_provider_date: {
          deviceId: device.id,
          provider: payload.provider,
          date,
        },
      },
      create: {
        memberId,
        deviceId: device.id,
        provider: payload.provider,
        date,
        tokenCategories: payload.tokenCategories,
        tokenDetails: nullableJson(payload.tokenDetails),
        totalTokens: BigInt(payload.totalTokens),
        costUsd: nullableCost(payload.costUsd),
        costSource: payload.costSource ?? null,
        costMetadata: nullableJson(payload.costMetadata),
        sourceSnapshot: nullableJson(payload.sourceSnapshot),
        cliVersion: payload.cliVersion,
        ccusageVersion: payload.ccusageVersion,
        os: payload.os,
        syncedAt,
      },
      update: {
        tokenCategories: payload.tokenCategories,
        tokenDetails: nullableJson(payload.tokenDetails),
        totalTokens: BigInt(payload.totalTokens),
        costUsd: nullableCost(payload.costUsd),
        costSource: payload.costSource ?? null,
        costMetadata: nullableJson(payload.costMetadata),
        sourceSnapshot: nullableJson(payload.sourceSnapshot),
        cliVersion: payload.cliVersion,
        ccusageVersion: payload.ccusageVersion,
        os: payload.os,
        syncedAt,
      },
      select: { id: true },
    });

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
          costUsd: nullableCost(model.costUsd),
          metadata: nullableJson(model.metadata),
        })),
      });
    }

    await tx.cliToken.update({
      where: { id: cliTokenId },
      data: { lastUsedAt: new Date() },
    });
  });
}

export function parseUtcDate(value: string): Date {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError("Invalid date");
  }

  return date;
}

function nullableCost(value: number | undefined): string | null {
  return value === undefined ? null : value.toFixed(6);
}

function nullableJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === undefined ? Prisma.JsonNull : value;
}
```

- [ ] **Step 5: Update sync route to use helper**

In `apps/web/src/app/api/sync/route.ts`, import the helper:

```ts
import { persistSyncPayload } from "@/server/sync-ingest";
```

Replace the inline transaction block with:

```ts
    await persistSyncPayload({
      cliTokenId: cliToken.id,
      memberId: cliToken.member.id,
      payload,
    });
```

Remove the old local `parseUtcDate` function from the route.

- [ ] **Step 6: Run persistence tests and sync route typecheck**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-ingest.test.ts
pnpm --filter @token-burn/web typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit web API persistence**

Run:

```bash
git add vitest.config.ts apps/web/src/server/sync-ingest.ts apps/web/src/server/sync-ingest.test.ts apps/web/src/app/api/sync/route.ts
git commit -m "feat(web): persist model and cost usage"
```

---

### Task 6: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @token-burn/shared test
pnpm --filter token-burn test
pnpm --filter @token-burn/web test
```

Expected: PASS.

- [ ] **Step 2: Run typechecks**

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

- [ ] **Step 4: Inspect git history and working tree**

Run:

```bash
git log --oneline -6
git status --short
```

Expected: recent commits include the task commits above. `git status --short` may show unrelated pre-existing local changes only if implementation happened in the original dirty worktree; do not stage or revert unrelated files.

---

## Self-Review Notes

- Spec coverage: shared validation, CLI normalization, sync payload propagation, Prisma persistence, API persistence, privacy-preserving aggregate storage, compatibility, and verification are covered.
- Reasoning output is stored under `tokenDetails`, not as a scoring category, so `totalTokens` remains equal to scoring token categories.
- The plan keeps display work out of scope, matching the design.
- The plan uses `ccusage` as the cost source and does not add Token Burn pricing calculations.
