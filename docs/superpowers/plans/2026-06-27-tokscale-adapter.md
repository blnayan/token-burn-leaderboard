# Tokscale Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI's `ccusage` collection adapter with a tokscale-backed adapter that supports explicit local/session providers, including Grok Build, while preserving Token Burn's existing daily sync payload contract.

**Architecture:** `packages/shared` remains the provider contract and maps Token Burn provider IDs to tokscale client IDs. The CLI adds `packages/cli/src/tokscale.ts`, invokes `tokscale graph --client <client> --since <date> --until <date>`, and normalizes daily graph contributions into the existing `NormalizedUsageRow` boundary. `sync-collection.ts` keeps provider iteration and payload validation, but uses source-neutral names and tokscale skipped-provider classification.

**Tech Stack:** TypeScript, pnpm workspaces, Zod 4, Vitest, Commander CLI, Node child_process, tokscale 4.x native CLI package, Next.js API tests.

---

## File Structure

- Modify `packages/shared/src/schemas.ts`: expand provider definitions, replace `ccusageCommand` metadata with `tokscaleClient`, and allow `costSource: "tokscale"` while retaining `"ccusage"`.
- Modify `packages/shared/src/schemas.test.ts`: assert the expanded provider order, labels, tokscale client mapping, and new cost source validation.
- Create `packages/cli/src/tokscale.ts`: tokscale command adapter, graph JSON normalization, fixture support, version lookup, and skippable error class.
- Create `packages/cli/src/tokscale.test.ts`: adapter tests replacing `ccusage.test.ts`.
- Delete `packages/cli/src/ccusage.ts` and `packages/cli/src/ccusage.test.ts` after consumers are migrated.
- Modify `packages/cli/src/sync-collection.ts`: import tokscale adapter, rename source-version injection, and classify tokscale unsupported/no-data errors as skipped.
- Modify `packages/cli/src/sync-collection.test.ts`: update imports, expectations, and cost source to tokscale.
- Modify `packages/cli/package.json`: replace `ccusage` dependency with `tokscale`.
- Modify `packages/cli/tsup.config.ts`: externalize `tokscale` instead of `ccusage`.
- Modify `packages/cli/src/postinstall.ts`, `packages/cli/src/postinstall.test.ts`, and `packages/cli/postinstall.mjs`: remove ccusage native chmod behavior and keep a no-op postinstall compatibility hook.
- Modify `README.md`, `docs/cli-install.md`, and `packages/cli/README.md`: describe tokscale as the source and document excluded login/sync providers.
- Verify web tests that derive from shared providers: `apps/web/src/server/sync-windows.test.ts`, `apps/web/src/app/api/cli/sync-windows/route.test.ts`, `apps/web/src/server/member-usage-query.test.ts`, `apps/web/src/components/member-usage-charts.test.tsx`.

## Task 1: Shared Provider Contract

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

In `packages/shared/src/schemas.test.ts`, replace the provider tests at the top with:

```ts
describe("providerSchema", () => {
  it("accepts every supported tokscale local provider in stable order", () => {
    expect(providers).toEqual([
      "claude_code",
      "codex",
      "opencode",
      "amp",
      "droid",
      "codebuff",
      "hermes",
      "pi",
      "goose",
      "kilo",
      "copilot",
      "gemini",
      "kimi",
      "qwen",
      "openclaw",
      "roocode",
      "kilocode",
      "mux",
      "zed",
      "kiro",
      "cline",
      "gjc",
      "grok",
      "jcode",
      "micode",
      "commandcode",
      "antigravity_cli",
      "junie",
      "zcode",
    ]);

    for (const provider of providers) {
      expect(providerSchema.parse(provider)).toBe(provider);
    }
  });

  it("exports readable labels and tokscale client names", () => {
    expect(providerMetadata.claude_code).toEqual({
      id: "claude_code",
      label: "Claude Code",
      tokscaleClient: "claude",
    });
    expect(providerMetadata.grok).toEqual({
      id: "grok",
      label: "Grok Build",
      tokscaleClient: "grok",
    });
    expect(providerMetadata.antigravity_cli).toEqual({
      id: "antigravity_cli",
      label: "Antigravity CLI",
      tokscaleClient: "antigravity-cli",
    });
    expect(formatProvider("opencode")).toBe("OpenCode");
    expect(formatProvider("gemini")).toBe("Gemini CLI");
  });

  it("rejects unknown providers", () => {
    expect(() => providerSchema.parse("future_provider")).toThrow();
  });
});
```

In the `"accepts cost, token details, and model usage rows"` sync payload test, change `costSource: "ccusage"` to `costSource: "tokscale"`, and keep a separate assertion that old rows still validate:

```ts
  it("accepts legacy ccusage cost source values", () => {
    const payload = syncPayloadSchema.parse({
      provider: "codex",
      date: "2026-06-01",
      tokenCategories: { input: 100 },
      totalTokens: 100,
      costUsd: 0.01,
      costSource: "ccusage",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(payload.costSource).toBe("ccusage");
  });
```

- [ ] **Step 2: Run shared tests and verify failure**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: FAIL because `providers` still has the ccusage set, metadata still uses `ccusageCommand`, and `costSource` only accepts `"ccusage"`.

- [ ] **Step 3: Update provider metadata and cost source schema**

In `packages/shared/src/schemas.ts`, replace `providerDefinitions` with:

```ts
export const providerDefinitions = [
  { id: "claude_code", label: "Claude Code", tokscaleClient: "claude" },
  { id: "codex", label: "Codex", tokscaleClient: "codex" },
  { id: "opencode", label: "OpenCode", tokscaleClient: "opencode" },
  { id: "amp", label: "Amp", tokscaleClient: "amp" },
  { id: "droid", label: "Droid", tokscaleClient: "droid" },
  { id: "codebuff", label: "Codebuff", tokscaleClient: "codebuff" },
  { id: "hermes", label: "Hermes Agent", tokscaleClient: "hermes" },
  { id: "pi", label: "pi-agent", tokscaleClient: "pi" },
  { id: "goose", label: "Goose", tokscaleClient: "goose" },
  { id: "kilo", label: "Kilo", tokscaleClient: "kilo" },
  { id: "copilot", label: "GitHub Copilot CLI", tokscaleClient: "copilot" },
  { id: "gemini", label: "Gemini CLI", tokscaleClient: "gemini" },
  { id: "kimi", label: "Kimi", tokscaleClient: "kimi" },
  { id: "qwen", label: "Qwen", tokscaleClient: "qwen" },
  { id: "openclaw", label: "OpenClaw", tokscaleClient: "openclaw" },
  { id: "roocode", label: "Roo Code", tokscaleClient: "roocode" },
  { id: "kilocode", label: "Kilo Code", tokscaleClient: "kilocode" },
  { id: "mux", label: "Mux", tokscaleClient: "mux" },
  { id: "zed", label: "Zed", tokscaleClient: "zed" },
  { id: "kiro", label: "Kiro", tokscaleClient: "kiro" },
  { id: "cline", label: "Cline", tokscaleClient: "cline" },
  { id: "gjc", label: "Gajae-Code", tokscaleClient: "gjc" },
  { id: "grok", label: "Grok Build", tokscaleClient: "grok" },
  { id: "jcode", label: "Jcode", tokscaleClient: "jcode" },
  { id: "micode", label: "MiMo Code", tokscaleClient: "micode" },
  { id: "commandcode", label: "Command Code", tokscaleClient: "commandcode" },
  { id: "antigravity_cli", label: "Antigravity CLI", tokscaleClient: "antigravity-cli" },
  { id: "junie", label: "Junie", tokscaleClient: "junie" },
  { id: "zcode", label: "ZCode", tokscaleClient: "zcode" },
] as const;
```

In `syncPayloadSchema`, replace:

```ts
costSource: z.literal("ccusage").optional(),
```

with:

```ts
costSource: z.enum(["ccusage", "tokscale"]).optional(),
```

- [ ] **Step 4: Run shared tests and verify pass**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared provider contract**

Run:

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat: define tokscale provider registry"
```

## Task 2: Tokscale Adapter Tests

**Files:**
- Create: `packages/cli/src/tokscale.test.ts`
- Delete in Task 4: `packages/cli/src/ccusage.test.ts`

- [ ] **Step 1: Create failing tokscale adapter tests**

Create `packages/cli/src/tokscale.test.ts` with:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { providers } from "@token-burn/shared";
import {
  UnsupportedTokscaleProviderError,
  buildTokscaleGraphArgs,
  normalizeTokscaleGraph,
  readProviderUsage,
} from "./tokscale.js";

const tempDirs: string[] = [];

async function createFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "token-burn-tokscale-fixture-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildTokscaleGraphArgs", () => {
  it("uses graph JSON output scoped to a tokscale client", () => {
    expect(buildTokscaleGraphArgs("claude_code")).toEqual(["graph", "--client", "claude", "--no-spinner"]);
    expect(buildTokscaleGraphArgs("grok")).toEqual(["graph", "--client", "grok", "--no-spinner"]);
    expect(buildTokscaleGraphArgs("antigravity_cli")).toEqual([
      "graph",
      "--client",
      "antigravity-cli",
      "--no-spinner",
    ]);
  });

  it("passes ISO since and until flags without compacting dates", () => {
    expect(buildTokscaleGraphArgs("codex", { since: "2026-06-05", until: "2026-06-06" })).toEqual([
      "graph",
      "--client",
      "codex",
      "--since",
      "2026-06-05",
      "--until",
      "2026-06-06",
      "--no-spinner",
    ]);
  });

  it("maps every supported provider to a tokscale client", () => {
    for (const provider of providers) {
      const args = buildTokscaleGraphArgs(provider);
      expect(args[0]).toBe("graph");
      expect(args).toContain("--client");
      expect(args).toContain("--no-spinner");
    }
  });
});

describe("normalizeTokscaleGraph", () => {
  it("normalizes daily graph contributions into provider and model rows", () => {
    const rows = normalizeTokscaleGraph("grok", {
      contributions: [
        {
          date: "2026-06-01",
          totals: { tokens: 600, cost: 0.456789, messages: 3 },
          tokenBreakdown: { input: 100, output: 200, cacheRead: 250, cacheWrite: 50, reasoning: 25 },
          clients: [
            {
              client: "grok",
              modelId: "grok-code-fast-1",
              providerId: "xai",
              tokens: { input: 100, output: 200, cacheRead: 250, cacheWrite: 50, reasoning: 25 },
              cost: 0.456789,
              messages: 3,
            },
          ],
        },
      ],
    });

    expect(rows).toEqual([
      {
        provider: "grok",
        date: "2026-06-01",
        tokenCategories: { input: 100, output: 200, cacheCreate: 50, cacheRead: 250 },
        tokenDetails: { reasoningOutput: 25 },
        totalTokens: 600,
        costUsd: 0.456789,
        costSource: "tokscale",
        costMetadata: { client: "grok", messages: 3, providerId: "xai" },
        sourceSnapshot: {
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationTokens: 50,
          cacheReadTokens: 250,
          reasoningOutputTokens: 25,
          totalCost: 0.456789,
          totalTokens: 600,
        },
        models: [
          {
            modelName: "grok-code-fast-1",
            tokenCategories: { input: 100, output: 200, cacheCreate: 50, cacheRead: 250 },
            tokenDetails: { reasoningOutput: 25 },
            totalTokens: 600,
            costUsd: 0.456789,
            metadata: { client: "grok", messages: 3, providerId: "xai" },
          },
        ],
      },
    ]);
  });

  it("combines multiple model rows on the same day", () => {
    const rows = normalizeTokscaleGraph("codex", {
      contributions: [
        {
          date: "2026-06-01",
          totals: { tokens: 300, cost: 0.3, messages: 2 },
          tokenBreakdown: { input: 100, output: 100, cacheRead: 50, cacheWrite: 50, reasoning: 0 },
          clients: [
            {
              client: "codex",
              modelId: "gpt-5",
              providerId: "openai",
              tokens: { input: 80, output: 70, cacheRead: 30, cacheWrite: 20, reasoning: 0 },
              cost: 0.2,
              messages: 1,
            },
            {
              client: "codex",
              modelId: "gpt-5-mini",
              providerId: "openai",
              tokens: { input: 20, output: 30, cacheRead: 20, cacheWrite: 30, reasoning: 0 },
              cost: 0.1,
              messages: 1,
            },
          ],
        },
      ],
    });

    expect(rows[0]?.tokenCategories).toEqual({ input: 100, output: 100, cacheCreate: 50, cacheRead: 50 });
    expect(rows[0]?.totalTokens).toBe(300);
    expect(rows[0]?.models?.map((model) => model.modelName)).toEqual(["gpt-5", "gpt-5-mini"]);
  });

  it("rejects malformed totals instead of fabricating usage", () => {
    expect(() =>
      normalizeTokscaleGraph("codex", {
        contributions: [
          {
            date: "2026-06-01",
            totals: { tokens: 999, cost: 0, messages: 1 },
            tokenBreakdown: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 0 },
            clients: [],
          },
        ],
      }),
    ).toThrow("tokscale daily contribution total does not match token breakdown");
  });
});

describe("readProviderUsage", () => {
  it("passes tokscale graph args and parses stdout", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        contributions: [
          {
            date: "2026-06-01",
            totals: { tokens: 10, cost: 0.01, messages: 1 },
            tokenBreakdown: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
            clients: [
              {
                client: "claude",
                modelId: "claude-sonnet-4",
                providerId: "anthropic",
                tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
                cost: 0.01,
                messages: 1,
              },
            ],
          },
        ],
      }),
      stderr: "",
    });

    await readProviderUsage("claude_code", { runCommand, window: { since: "2026-06-01", until: "2026-06-01" } });

    expect(runCommand).toHaveBeenCalledWith("tokscale", [
      "graph",
      "--client",
      "claude",
      "--since",
      "2026-06-01",
      "--until",
      "2026-06-01",
      "--no-spinner",
    ]);
  });

  it("reads provider fixture files from TOKEN_BURN_E2E_FIXTURE_DIR without invoking tokscale", async () => {
    const fixtureDir = await createFixtureDir();
    const runCommand = vi.fn().mockRejectedValue(new Error("tokscale should not be invoked in fixture mode"));

    await writeFile(
      join(fixtureDir, "grok.json"),
      JSON.stringify({
        contributions: [
          {
            date: "2026-06-01",
            totals: { tokens: 5, cost: 0.02, messages: 1 },
            tokenBreakdown: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
            clients: [
              {
                client: "grok",
                modelId: "grok-code-fast-1",
                providerId: "xai",
                tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
                cost: 0.02,
                messages: 1,
              },
            ],
          },
        ],
      }),
      "utf8",
    );
    vi.stubEnv("TOKEN_BURN_E2E_FIXTURE_DIR", fixtureDir);

    await expect(readProviderUsage("grok", { runCommand })).resolves.toMatchObject([
      { provider: "grok", date: "2026-06-01", totalTokens: 5 },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("classifies unsupported tokscale clients", async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error("invalid value 'grok' for '--client <CLIENT>'"));

    await expect(readProviderUsage("grok", { runCommand })).rejects.toEqual(
      new UnsupportedTokscaleProviderError("grok"),
    );
  });
});
```

- [ ] **Step 2: Run adapter tests and verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/tokscale.test.ts
```

Expected: FAIL because `packages/cli/src/tokscale.ts` does not exist.

## Task 3: Tokscale Adapter Implementation

**Files:**
- Create: `packages/cli/src/tokscale.ts`
- Test: `packages/cli/src/tokscale.test.ts`

- [ ] **Step 1: Implement the tokscale adapter**

Create `packages/cli/src/tokscale.ts` with these exported boundaries and helper behavior:

```ts
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { formatProvider, providerMetadata, sumTokenCategories, type Provider } from "@token-burn/shared";

type NormalizedTokenCategories = {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
};

type NormalizedTokenDetails = {
  reasoningOutput?: number;
};

type CostMetadata = Record<string, unknown>;

type SourceSnapshot = Partial<
  Record<
    | "cacheCreationTokens"
    | "cacheReadTokens"
    | "costUSD"
    | "inputTokens"
    | "outputTokens"
    | "reasoningOutputTokens"
    | "totalCost"
    | "totalTokens",
    number
  >
>;

export type NormalizedModelUsage = {
  modelName: string;
  tokenCategories: NormalizedTokenCategories;
  tokenDetails?: NormalizedTokenDetails;
  totalTokens: number;
  costUsd?: number;
  metadata?: CostMetadata;
};

export type NormalizedUsageRow = {
  provider: Provider;
  date: string;
  tokenCategories: NormalizedTokenCategories;
  tokenDetails?: NormalizedTokenDetails;
  totalTokens: number;
  costUsd?: number;
  costSource?: "ccusage" | "tokscale";
  costMetadata?: CostMetadata;
  sourceSnapshot?: SourceSnapshot;
  models?: NormalizedModelUsage[];
};

export type ProviderUsageWindow = {
  since?: string;
  until: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type CommandInvocation = {
  command: string;
  args: string[];
};

const requireFromCli = createRequire(import.meta.url);

export class UnsupportedTokscaleProviderError extends Error {
  readonly provider: Provider;

  constructor(provider: Provider) {
    super(`tokscale does not support ${formatProvider(provider)} usage in the installed version.`);
    this.name = "UnsupportedTokscaleProviderError";
    this.provider = provider;
  }
}

export function isUnsupportedTokscaleProviderError(error: unknown): error is UnsupportedTokscaleProviderError {
  return error instanceof UnsupportedTokscaleProviderError;
}
```

Add these exported command and read functions:

```ts
export function buildTokscaleGraphArgs(provider: Provider, window?: ProviderUsageWindow): string[] {
  const args = ["graph", "--client", providerMetadata[provider].tokscaleClient];

  if (window?.since) {
    args.push("--since", window.since, "--until", window.until);
  }

  args.push("--no-spinner");
  return args;
}

export async function readProviderUsage(
  provider: Provider,
  { runCommand = spawnCommand, window }: { runCommand?: CommandRunner; window?: ProviderUsageWindow } = {},
): Promise<NormalizedUsageRow[]> {
  const fixtureDir = process.env.TOKEN_BURN_E2E_FIXTURE_DIR;

  if (fixtureDir) {
    return readProviderUsageFixture(provider, fixtureDir);
  }

  let result: CommandResult;

  try {
    result = await runCommand("tokscale", buildTokscaleGraphArgs(provider, window));
  } catch (error) {
    if (isUnsupportedProviderCommandError(error, provider)) {
      throw new UnsupportedTokscaleProviderError(provider);
    }

    throw error;
  }

  return normalizeTokscaleGraph(provider, JSON.parse(result.stdout) as unknown);
}

export async function readTokscaleVersion(): Promise<string> {
  const packageJsonPath = requireFromCli.resolve("tokscale/package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const version = toRecord(parsed).version;

  if (typeof version !== "string" || !version) {
    throw new Error("Unable to determine tokscale version.");
  }

  return version;
}
```

Add normalization functions that parse tokscale graph output:

```ts
export function normalizeTokscaleGraph(provider: Provider, graph: unknown): NormalizedUsageRow[] {
  const contributions = readContributions(graph);

  return contributions
    .map((contribution) => normalizeContribution(provider, toRecord(contribution)))
    .filter((row): row is NormalizedUsageRow => row !== null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeContribution(provider: Provider, contribution: Record<string, unknown>): NormalizedUsageRow | null {
  const date = readIsoDate(contribution.date, "tokscale daily contribution date");
  const tokenCategories = readTokenCategories(contribution.tokenBreakdown ?? contribution.token_breakdown);
  const totalTokens = readTotalTokens(contribution.totals, tokenCategories);
  const costUsd = readCost(contribution.totals, "cost");
  const messageCount = readMessages(contribution.totals);
  const tokenDetails = readTokenDetails(contribution.tokenBreakdown ?? contribution.token_breakdown);
  const models = readModelRows(contribution.clients, provider);

  if (totalTokens === 0 && models.length === 0) {
    return null;
  }

  const row: NormalizedUsageRow = {
    provider,
    date,
    tokenCategories,
    totalTokens,
    costSource: "tokscale",
    costMetadata: {
      client: providerMetadata[provider].tokscaleClient,
      messages: messageCount,
    },
    sourceSnapshot: {
      inputTokens: tokenCategories.input,
      outputTokens: tokenCategories.output,
      cacheCreationTokens: tokenCategories.cacheCreate,
      cacheReadTokens: tokenCategories.cacheRead,
      totalTokens,
    },
  };

  if (tokenDetails) {
    row.tokenDetails = tokenDetails;
    row.sourceSnapshot = { ...row.sourceSnapshot, reasoningOutputTokens: tokenDetails.reasoningOutput };
  }

  if (costUsd > 0) {
    row.costUsd = costUsd;
    row.sourceSnapshot = { ...row.sourceSnapshot, totalCost: costUsd };
  }

  if (models.length > 0) {
    row.models = models;
    const providerIds = [...new Set(models.map((model) => model.metadata?.providerId).filter(Boolean))];
    if (providerIds.length === 1) {
      row.costMetadata = { ...row.costMetadata, providerId: providerIds[0] };
    }
  }

  return row;
}
```

Add model and scalar readers:

```ts
function readModelRows(value: unknown, provider: Provider): NormalizedModelUsage[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const record = toRecord(entry);
      const modelName = readString(record.modelId ?? record.model_id, "tokscale client modelId");
      const tokenCategories = readTokenCategories(record.tokens);
      const totalTokens = sumTokenCategories(tokenCategories);
      const tokenDetails = readTokenDetails(record.tokens);
      const costUsd = readCost(record, "cost");
      const providerId = typeof record.providerId === "string" ? record.providerId : record.provider_id;
      const client = typeof record.client === "string" ? record.client : providerMetadata[provider].tokscaleClient;
      const messages = readInteger(record.messages, "tokscale client messages");
      const metadata: CostMetadata = { client, messages };

      if (typeof providerId === "string" && providerId) {
        metadata.providerId = providerId;
      }

      const normalized: NormalizedModelUsage = {
        modelName,
        tokenCategories,
        totalTokens,
        metadata,
      };

      if (tokenDetails) normalized.tokenDetails = tokenDetails;
      if (costUsd > 0) normalized.costUsd = costUsd;

      return normalized;
    })
    .filter((model) => model.totalTokens > 0)
    .sort((left, right) => left.modelName.localeCompare(right.modelName));
}

function readTokenCategories(value: unknown): NormalizedTokenCategories {
  const record = toRecord(value);
  const tokenCategories = {
    input: readInteger(record.input, "tokscale input tokens"),
    output: readInteger(record.output, "tokscale output tokens"),
    cacheCreate: readInteger(record.cacheWrite ?? record.cache_write, "tokscale cache write tokens"),
    cacheRead: readInteger(record.cacheRead ?? record.cache_read, "tokscale cache read tokens"),
  };
  return tokenCategories;
}

function readTokenDetails(value: unknown): NormalizedTokenDetails | undefined {
  const record = toRecord(value);
  const reasoningOutput = readInteger(record.reasoning, "tokscale reasoning tokens");
  return reasoningOutput > 0 ? { reasoningOutput } : undefined;
}

function readTotalTokens(totals: unknown, tokenCategories: NormalizedTokenCategories): number {
  const totalTokens = readInteger(toRecord(totals).tokens, "tokscale total tokens");
  const expected = sumTokenCategories(tokenCategories);

  if (totalTokens !== expected) {
    throw new Error("tokscale daily contribution total does not match token breakdown.");
  }

  return totalTokens;
}
```

Add process, fixture, and utility helpers:

```ts
async function readProviderUsageFixture(provider: Provider, fixtureDir: string): Promise<NormalizedUsageRow[]> {
  const fixturePath = join(fixtureDir, `${provider}.json`);

  try {
    const raw = await readFile(fixturePath, "utf8");
    return normalizeTokscaleGraph(provider, JSON.parse(raw) as unknown);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

function spawnCommand(command: string, args: string[]): Promise<CommandResult> {
  const invocation = command === "tokscale" ? resolveTokscaleInvocation(args) : { command, args };

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || `tokscale exited with status ${code ?? "unknown"}.`));
    });
  });
}

function resolveTokscaleInvocation(args: string[]): CommandInvocation {
  const binPath = resolveTokscaleBinPath();
  return { command: process.execPath, args: [binPath, ...args] };
}

function resolveTokscaleBinPath(): string {
  const packageJsonPath = requireFromCli.resolve("tokscale/package.json");
  const packageRoot = dirname(packageJsonPath);
  const parsed = requireFromCli(packageJsonPath) as { bin?: string | Record<string, string> };
  const bin = typeof parsed.bin === "string" ? parsed.bin : parsed.bin?.tokscale;

  if (!bin) {
    throw new Error("Unable to determine tokscale executable path.");
  }

  return resolve(packageRoot, bin);
}

function isUnsupportedProviderCommandError(error: unknown, provider: Provider): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const client = providerMetadata[provider].tokscaleClient;
  return (
    message.includes(`invalid value '${client}'`) ||
    message.includes(`invalid value "${client}"`) ||
    message.includes(`unknown client ${client}`) ||
    message.includes(`unsupported client ${client}`)
  );
}
```

Use the existing `ccusage.ts` reader style for these remaining local helpers:

```ts
function readContributions(value: unknown): unknown[] {
  const contributions = toRecord(value).contributions;
  if (!Array.isArray(contributions)) {
    throw new Error("Expected tokscale graph JSON output to include a contributions array.");
  }
  return contributions;
}

function readIsoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value.trim();
}

function readInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return Math.trunc(value);
}

function readCost(value: unknown, field: string): number {
  const raw = toRecord(value)[field];
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1_000_000) {
    throw new Error(`tokscale ${field} is invalid.`);
  }
  return raw;
}

function readMessages(value: unknown): number {
  return readInteger(toRecord(value).messages, "tokscale message count");
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected tokscale JSON value to be an object.");
  }
  return value as Record<string, unknown>;
}
```

- [ ] **Step 2: Run tokscale adapter tests and verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/tokscale.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit tokscale adapter**

Run:

```bash
git add packages/cli/src/tokscale.ts packages/cli/src/tokscale.test.ts
git commit -m "feat: add tokscale usage adapter"
```

## Task 4: Sync Collection Migration

**Files:**
- Modify: `packages/cli/src/sync-collection.ts`
- Modify: `packages/cli/src/sync-collection.test.ts`
- Delete: `packages/cli/src/ccusage.ts`
- Delete: `packages/cli/src/ccusage.test.ts`

- [ ] **Step 1: Update sync collection tests for tokscale**

In `packages/cli/src/sync-collection.test.ts`, replace the unsupported error import:

```ts
import { UnsupportedTokscaleProviderError } from "./tokscale.js";
```

Replace every `readCcusageVersion` test injection with `readUsageSourceVersion`, and every `"20.0.6"` version expectation with `"4.0.4"`.

In payload fixtures, change new source rows from:

```ts
costSource: "ccusage",
sourceSnapshot: { costUSD: 0.123456, totalTokens: 125 },
```

to:

```ts
costSource: "tokscale",
sourceSnapshot: { totalCost: 0.123456, totalTokens: 125 },
```

Replace the unsupported-provider test with:

```ts
  it("classifies unsupported tokscale providers as skipped", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readUsageSourceVersion: async () => "4.0.4",
      readProviderUsage: async (provider) => {
        if (provider === "codex") throw new UnsupportedTokscaleProviderError("codex");
        return [];
      },
    });

    expect(result).toEqual({
      submitted: 0,
      failedProviders: [],
      skippedProviders: [
        {
          provider: "codex",
          message: "tokscale does not support Codex usage in the installed version",
        },
      ],
    });
  });
```

Replace the native binary permission test with a tokscale native binary message:

```ts
  it("normalizes tokscale native binary permission failures", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readUsageSourceVersion: async () => "4.0.4",
      readProviderUsage: async () => {
        throw new Error("tokscale native binary is not executable: EPERM spawn");
      },
    });

    expect(result.failedProviders[0]?.message).toBe(
      "tokscale native binary is not executable. Reinstall @blnayan/token-burn in a user-writable Node environment, or reinstall the package so npm can restore tokscale optional native binaries",
    );
  });
```

- [ ] **Step 2: Run sync collection tests and verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync-collection.test.ts
```

Expected: FAIL because `sync-collection.ts` still imports ccusage symbols and exposes `readCcusageVersion`.

- [ ] **Step 3: Update sync collection implementation**

In `packages/cli/src/sync-collection.ts`, replace imports from `./ccusage.js` with:

```ts
import type { NormalizedUsageRow, ProviderUsageWindow } from "./tokscale.js";
import {
  isUnsupportedTokscaleProviderError,
  readProviderUsage as readProviderUsageFromTokscale,
  readTokscaleVersion,
} from "./tokscale.js";
```

Change `SyncCollectionOptions` fields:

```ts
readProviderUsage?: (provider: Provider, options?: { window?: ProviderUsageWindow }) => Promise<NormalizedUsageRow[]>;
readUsageSourceVersion?: () => Promise<string>;
```

Change the destructuring defaults:

```ts
readProviderUsage = readProviderUsageFromTokscale,
readUsageSourceVersion = readTokscaleVersion,
```

Change source version lookup and payload metadata naming:

```ts
const usageSourceVersion = await readUsageSourceVersion();
```

and:

```ts
const payload = buildPayload(row, { cliVersion, usageSourceVersion, deviceId, deviceName, platform, syncedAt });
```

In `buildPayload`, rename the metadata property to `usageSourceVersion` and keep the wire field unchanged:

```ts
ccusageVersion: metadata.usageSourceVersion,
```

Update skippable and permission helpers:

```ts
function isSkippableProviderError(error: unknown): boolean {
  if (isUnsupportedTokscaleProviderError(error)) return true;

  return isMissingProviderDataError(toError(error));
}

function isTokscaleNativeBinaryPermissionError(error: Error): boolean {
  return error.message.includes("tokscale native binary is not executable") && error.message.includes("EPERM");
}
```

In `normalizeProviderError`, replace the ccusage permission branch with:

```ts
  if (isTokscaleNativeBinaryPermissionError(normalizedError)) {
    return new Error(
      "tokscale native binary is not executable. Reinstall @blnayan/token-burn in a user-writable Node environment, or reinstall the package so npm can restore tokscale optional native binaries",
    );
  }
```

- [ ] **Step 4: Run sync collection tests and verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync-collection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Delete old ccusage adapter files**

Run:

```bash
git rm packages/cli/src/ccusage.ts packages/cli/src/ccusage.test.ts
```

- [ ] **Step 6: Commit sync collection migration**

Run:

```bash
git add packages/cli/src/sync-collection.ts packages/cli/src/sync-collection.test.ts
git commit -m "feat: collect usage from tokscale"
```

## Task 5: Dependency And Postinstall Cleanup

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/tsup.config.ts`
- Modify: `packages/cli/src/postinstall.ts`
- Modify: `packages/cli/src/postinstall.test.ts`
- Modify: `packages/cli/postinstall.mjs`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing postinstall tests**

Replace `packages/cli/src/postinstall.test.ts` with:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyTokscalePostinstall } from "./postinstall.js";

describe("verifyTokscalePostinstall", () => {
  it("does not require native chmod fixes on POSIX platforms", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "token-burn-postinstall-"));

    await expect(verifyTokscalePostinstall({ rootDir, platform: "linux" })).resolves.toEqual([]);
  });

  it("does nothing on Windows", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "token-burn-postinstall-"));

    await expect(verifyTokscalePostinstall({ rootDir, platform: "win32" })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run postinstall tests and verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/postinstall.test.ts
```

Expected: FAIL because `verifyTokscalePostinstall` is not exported.

- [ ] **Step 3: Replace postinstall implementation with a no-op compatibility hook**

Replace `packages/cli/src/postinstall.ts` with:

```ts
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

type SupportedPlatform = NodeJS.Platform | "win32";

type VerifyOptions = {
  rootDir?: string;
  platform?: SupportedPlatform;
};

export async function verifyTokscalePostinstall(_options: VerifyOptions = {}): Promise<string[]> {
  return [];
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await verifyTokscalePostinstall();
}
```

Replace `packages/cli/postinstall.mjs` with:

```js
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const builtPostinstallPath = join(packageRoot, "dist", "postinstall.js");

if (existsSync(builtPostinstallPath)) {
  const { verifyTokscalePostinstall } = await import(pathToFileURL(builtPostinstallPath).href);
  await verifyTokscalePostinstall();
}
```

In `packages/cli/tsup.config.ts`, change:

```ts
external: ["ccusage", "commander", "zod"],
```

to:

```ts
external: ["commander", "tokscale", "zod"],
```

In `packages/cli/package.json`, replace:

```json
"ccusage": "^20.0.6",
```

with:

```json
"tokscale": "^4.0.4",
```

- [ ] **Step 4: Refresh lockfile**

Run:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` removes `ccusage` dependency edges for the CLI package and adds `tokscale`.

- [ ] **Step 5: Run package tests and build**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/postinstall.test.ts src/tokscale.test.ts src/sync-collection.test.ts
pnpm --filter @blnayan/token-burn typecheck
pnpm --filter @blnayan/token-burn build
```

Expected: PASS.

- [ ] **Step 6: Commit dependency cleanup**

Run:

```bash
git add packages/cli/package.json packages/cli/tsup.config.ts packages/cli/src/postinstall.ts packages/cli/src/postinstall.test.ts packages/cli/postinstall.mjs pnpm-lock.yaml
git commit -m "chore: replace ccusage dependency with tokscale"
```

## Task 6: Web Provider Surface Verification

**Files:**
- Review and modify when expectations are hard-coded: `apps/web/src/server/sync-windows.test.ts`
- Review and modify when expectations are hard-coded: `apps/web/src/app/api/cli/sync-windows/route.test.ts`
- Review and modify when expectations are hard-coded: `apps/web/src/server/member-usage-query.test.ts`
- Review and modify when labels are hard-coded: `apps/web/src/components/member-usage-charts.test.tsx`

- [ ] **Step 1: Run provider-derived web tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts src/app/api/cli/sync-windows/route.test.ts src/server/member-usage-query.test.ts src/components/member-usage-charts.test.tsx
```

Expected: either PASS if these tests already derive from `providers`, or FAIL where expected provider arrays/labels need the expanded list.

- [ ] **Step 2: Update sync-window expectations to derive from shared providers**

If a test hard-codes provider arrays, import `providers`:

```ts
import { providers } from "@token-burn/shared";
```

Use this expectation pattern:

```ts
expect(result.providers).toEqual(
  providers.map((provider) =>
    provider === "codex" ? { provider, since: "2026-06-06" } : { provider },
  ),
);
```

For tests with a Claude row:

```ts
expect(result.providers).toEqual(
  providers.map((provider) =>
    provider === "claude_code" ? { provider, since: "2026-06-05" } : { provider },
  ),
);
```

- [ ] **Step 3: Add member usage label coverage for new providers**

In `apps/web/src/components/member-usage-charts.test.tsx`, add or extend the provider label test with these providers:

```ts
providers: [
  { provider: "grok", totalTokens: 5000, totalCostUsd: 5 },
  { provider: "zed", totalTokens: 4000, totalCostUsd: 4 },
  { provider: "antigravity_cli", totalTokens: 3000, totalCostUsd: 3 },
],
models: [
  { provider: "grok", modelName: "grok-code-fast-1", totalTokens: 5000, totalCostUsd: 5 },
],
```

Assert labels:

```ts
expect(within(providersSection).getByRole("button", { name: /Grok Build/ })).toBeTruthy();
expect(within(providersSection).getByRole("button", { name: /Zed/ })).toBeTruthy();
expect(within(providersSection).getByRole("button", { name: /Antigravity CLI/ })).toBeTruthy();
```

- [ ] **Step 4: Run provider-derived web tests and verify pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts src/app/api/cli/sync-windows/route.test.ts src/server/member-usage-query.test.ts src/components/member-usage-charts.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit web provider surface updates**

Run:

```bash
git add apps/web/src/server/sync-windows.test.ts apps/web/src/app/api/cli/sync-windows/route.test.ts apps/web/src/server/member-usage-query.test.ts apps/web/src/components/member-usage-charts.test.tsx
git commit -m "test: cover tokscale provider surfaces"
```

If no files changed because the tests already passed, skip this commit and record that in the implementation notes.

## Task 7: Documentation And User-Facing Text

**Files:**
- Modify: `README.md`
- Modify: `docs/cli-install.md`
- Modify: `packages/cli/README.md`
- Inspect and modify if they contain active ccusage user-facing text: `packages/cli/src/index.ts`, `packages/cli/src/sync.ts`

- [ ] **Step 1: Replace source wording in docs**

In `README.md`, replace the opening source sentence with:

```md
Token Burn is a private-invite leaderboard for aggregate coding-agent token usage reported by `tokscale`. The web app shows member totals, and the `token-burn` CLI syncs local daily usage totals from each member's machine.
```

Replace the privacy bullet:

```md
- Raw `tokscale` contribution rows
```

Replace the metadata bullet:

```md
- Device name, OS, CLI version, tokscale version, and sync timestamp
```

In `docs/cli-install.md`, replace the ccusage native-binary paragraph with:

```md
The CLI bundles tokscale through npm. If `token-burn sync` reports that the tokscale native binary cannot execute, reinstall `@blnayan/token-burn` in a user-writable Node environment such as `nvm`, or reinstall the package so npm can restore tokscale's optional native package for your platform.
```

In `packages/cli/README.md`, replace references to ccusage with tokscale and add this scope note:

```md
Token Burn syncs tokscale local/session providers. Providers that require a separate tokscale login or sync step, such as Cursor, Trae, Antigravity IDE, and Warp/Oz aggregate usage, are intentionally excluded from Token Burn sync for now.
```

- [ ] **Step 2: Search remaining active ccusage references**

Run:

```bash
rg -n "ccusage|Ccusage|CCUSAGE" README.md docs packages apps -S -g '!docs/superpowers/**'
```

Expected: only historical docs/plans or database/API field names remain. Active CLI docs and user-facing command text should say tokscale.

- [ ] **Step 3: Run docs-adjacent checks**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/index.test.ts src/sync-collection.test.ts
pnpm --filter @blnayan/token-burn typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit documentation updates**

Run:

```bash
git add README.md docs/cli-install.md packages/cli/README.md packages/cli/src/index.ts packages/cli/src/sync.ts
git commit -m "docs: describe tokscale usage source"
```

If `packages/cli/src/index.ts` and `packages/cli/src/sync.ts` did not change, omit them from `git add`.

## Task 8: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
pnpm --filter @blnayan/token-burn test -- src/tokscale.test.ts src/sync-collection.test.ts src/postinstall.test.ts
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts src/app/api/cli/sync-windows/route.test.ts src/server/member-usage-query.test.ts src/components/member-usage-charts.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typechecks and build**

Run:

```bash
pnpm --filter @token-burn/shared typecheck
pnpm --filter @blnayan/token-burn typecheck
pnpm --filter @token-burn/web typecheck
pnpm --filter @blnayan/token-burn build
```

Expected: PASS.

- [ ] **Step 3: Run repository status and inspect remaining ccusage references**

Run:

```bash
git status --short
rg -n "ccusage|Ccusage|CCUSAGE" packages apps README.md docs/cli-install.md -S
```

Expected: `git status --short` only shows intentional uncommitted user changes if they existed before implementation. The `rg` output may include `ccusageVersion` schema/DB field names and historical spec files, but should not include active source adapter imports, dependencies, or user-facing docs that still claim ccusage is the current source.

- [ ] **Step 4: Record verification output**

Add a short implementation note to the final response listing each command from Steps 1-3 and whether it passed. Do not commit this note unless the user asks for a PR description or changelog.
