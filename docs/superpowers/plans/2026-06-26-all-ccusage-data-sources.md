# All ccusage Data Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync every ccusage 20.0.6 data source as its own Token Burn provider, using the same provider-shaped behavior as Claude Code and Codex.

**Architecture:** Add a shared provider registry with IDs, display labels, and ccusage command names. The CLI ccusage adapter maps provider IDs to focused `ccusage <source> daily` commands, sync collection iterates the shared provider list, and the web app reuses shared provider metadata for sync windows, validation, and UI labels.

**Tech Stack:** TypeScript, Zod, Vitest, pnpm workspaces, ccusage 20.0.6, Next.js, Prisma.

---

## File Structure

- Modify `packages/shared/src/schemas.ts`: add provider metadata, export a stable `providers` array, expose provider labels, and expand `providerSchema`.
- Modify `packages/shared/src/schemas.test.ts`: prove the full provider set is accepted and unknown public providers still fail.
- Modify `packages/cli/src/ccusage.ts`: change `CcusageProvider` to all shared providers, map providers to ccusage commands, preserve Claude breakdown fallback, and classify unsupported provider commands.
- Modify `packages/cli/src/ccusage.test.ts`: add mapping, window, fixture, and unsupported-provider tests for the expanded set.
- Modify `packages/cli/src/sync-collection.ts`: iterate the shared provider registry and generalize missing-data skip classification.
- Modify `packages/cli/src/sync-collection.test.ts`: expect all providers and verify new-provider submission/skips.
- Modify `apps/web/src/server/sync-windows.ts`: reuse shared provider guards from the registry.
- Modify `apps/web/src/server/sync-windows.test.ts`: expect every provider in sync windows.
- Modify `apps/web/src/app/api/cli/sync-windows/route.test.ts`: expect expanded provider response at the route boundary.
- Modify `apps/web/src/server/member-usage-query.test.ts`: add new-provider parsing and encoding coverage.
- Modify `apps/web/src/components/member-usage-charts.tsx`: render provider labels from shared metadata instead of a two-provider local helper.
- Modify `apps/web/src/components/member-usage-charts.test.tsx`: cover new provider labels and callback IDs.
- Modify `README.md` and `packages/cli/package.json`: update user-facing wording that still says only Claude Code and Codex.

## Task 1: Shared Provider Registry

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Write the failing shared provider tests**

In `packages/shared/src/schemas.test.ts`, update the import from `./schemas` to include the new exports:

```ts
import {
  formatProvider,
  leaderboardRowSchema,
  memberUsageDetailSchema,
  memberUsageRangeSchema,
  periodSchema,
  providerMetadata,
  providerSchema,
  providers,
  syncPayloadSchema,
  syncWindowsResponseSchema,
  tokenCategoriesSchema,
} from "./schemas";
```

Replace the current `providerSchema` test with:

```ts
describe("providerSchema", () => {
  it("accepts every supported ccusage provider in stable order", () => {
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
    ]);

    for (const provider of providers) {
      expect(providerSchema.parse(provider)).toBe(provider);
    }
  });

  it("exports readable labels and ccusage command names", () => {
    expect(providerMetadata.claude_code).toEqual({
      id: "claude_code",
      label: "Claude Code",
      ccusageCommand: "claude",
    });
    expect(providerMetadata.copilot).toEqual({
      id: "copilot",
      label: "GitHub Copilot CLI",
      ccusageCommand: "copilot",
    });
    expect(formatProvider("opencode")).toBe("OpenCode");
    expect(formatProvider("gemini")).toBe("Gemini CLI");
  });

  it("rejects unknown providers", () => {
    expect(() => providerSchema.parse("future_provider")).toThrow();
  });
});
```

In the `syncPayloadSchema` block, add this test after `"accepts aggregate daily provider snapshots"`:

```ts
  it("accepts expanded ccusage providers in sync payloads", () => {
    const payload = syncPayloadSchema.parse({
      provider: "opencode",
      date: "2026-06-01",
      tokenCategories: {
        input: 50,
        output: 25,
        cacheCreate: 0,
        cacheRead: 5,
      },
      totalTokens: 80,
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(payload.provider).toBe("opencode");
  });
```

In the `memberUsageDetailSchema` acceptance test, change one provider/model pair to `gemini`:

```ts
        providers: [
          {
            provider: "gemini",
            totalTokens: 100,
            totalCostUsd: 1.25,
          },
        ],
        models: [
          {
            modelName: "gemini-2.5-pro",
            provider: "gemini",
            totalTokens: 80,
            totalCostUsd: 1,
          },
        ],
```

- [ ] **Step 2: Run shared schema tests and verify failure**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: FAIL with missing exports such as `providerMetadata` or with provider enum rejecting `opencode`.

- [ ] **Step 3: Implement the shared provider registry**

In `packages/shared/src/schemas.ts`, replace the current provider schema exports with:

```ts
export const providerDefinitions = [
  { id: "claude_code", label: "Claude Code", ccusageCommand: "claude" },
  { id: "codex", label: "Codex", ccusageCommand: "codex" },
  { id: "opencode", label: "OpenCode", ccusageCommand: "opencode" },
  { id: "amp", label: "Amp", ccusageCommand: "amp" },
  { id: "droid", label: "Droid", ccusageCommand: "droid" },
  { id: "codebuff", label: "Codebuff", ccusageCommand: "codebuff" },
  { id: "hermes", label: "Hermes Agent", ccusageCommand: "hermes" },
  { id: "pi", label: "pi-agent", ccusageCommand: "pi" },
  { id: "goose", label: "Goose", ccusageCommand: "goose" },
  { id: "kilo", label: "Kilo", ccusageCommand: "kilo" },
  { id: "copilot", label: "GitHub Copilot CLI", ccusageCommand: "copilot" },
  { id: "gemini", label: "Gemini CLI", ccusageCommand: "gemini" },
  { id: "kimi", label: "Kimi", ccusageCommand: "kimi" },
  { id: "qwen", label: "Qwen", ccusageCommand: "qwen" },
  { id: "openclaw", label: "OpenClaw", ccusageCommand: "openclaw" },
] as const;

type ProviderDefinition = (typeof providerDefinitions)[number];
type ProviderId = ProviderDefinition["id"];

export const providers = providerDefinitions.map((provider) => provider.id) as [
  ProviderId,
  ...ProviderId[],
];

export const providerSchema = z.enum(providers);
export type Provider = z.infer<typeof providerSchema>;

export const providerMetadata = Object.fromEntries(
  providerDefinitions.map((provider) => [provider.id, provider]),
) as Record<Provider, ProviderDefinition>;

export function formatProvider(provider: Provider): string {
  return providerMetadata[provider].label;
}
```

Keep the rest of the file unchanged.

- [ ] **Step 4: Run shared schema tests and verify pass**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit shared registry**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/schemas.test.ts
git commit -m "feat: add ccusage provider registry"
```

## Task 2: CLI ccusage Adapter

**Files:**
- Modify: `packages/cli/src/ccusage.ts`
- Modify: `packages/cli/src/ccusage.test.ts`

- [ ] **Step 1: Write failing provider command mapping tests**

In `packages/cli/src/ccusage.test.ts`, add `providers` to the imports:

```ts
import { providers } from "@token-burn/shared";
```

In the `buildCcusageArgs` describe block, after the Codex window test, add:

```ts
  it("maps every supported provider to its focused ccusage daily command", () => {
    const expectedCommands = {
      claude_code: "claude",
      codex: "codex",
      opencode: "opencode",
      amp: "amp",
      droid: "droid",
      codebuff: "codebuff",
      hermes: "hermes",
      pi: "pi",
      goose: "goose",
      kilo: "kilo",
      copilot: "copilot",
      gemini: "gemini",
      kimi: "kimi",
      qwen: "qwen",
      openclaw: "openclaw",
    } as const;

    for (const provider of providers) {
      const args = buildCcusageArgs(provider);
      expect(args.slice(0, 5)).toEqual([
        expectedCommands[provider],
        "daily",
        "--json",
        "--timezone",
        "UTC",
      ]);
    }
  });

  it("adds YYYYMMDD since and until flags for new providers", () => {
    expect(buildCcusageArgs("opencode", false, { since: "2026-06-05", until: "2026-06-06" })).toEqual([
      "opencode",
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

In the `readProviderUsage` describe block, after the Codex args test, add:

```ts
  it("passes new provider UTC daily JSON args to ccusage", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        daily: [
          {
            date: "2026-06-01",
            inputTokens: 25,
            outputTokens: 5,
          },
        ],
      }),
      stderr: "",
    });

    await readProviderUsage("opencode", { runCommand });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand.mock.calls[0]?.[1]).toEqual(["opencode", "daily", "--json", "--timezone", "UTC"]);
  });
```

After the Codex fixture test, add:

```ts
  it("reads fixture rows for new providers", async () => {
    const fixtureDir = await createFixtureDir();
    const runCommand = vi.fn().mockRejectedValue(new Error("ccusage should not be invoked in fixture mode"));

    await writeFile(
      join(fixtureDir, "opencode.json"),
      JSON.stringify({
        daily: [
          {
            date: "2026-06-03",
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        ],
      }),
      "utf8",
    );
    vi.stubEnv("TOKEN_BURN_E2E_FIXTURE_DIR", fixtureDir);

    await expect(readProviderUsage("opencode", { runCommand })).resolves.toEqual([
      {
        provider: "opencode",
        date: "2026-06-03",
        tokenCategories: {
          input: 100,
          output: 50,
          cacheCreate: 0,
          cacheRead: 0,
        },
        totalTokens: 150,
      },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });
```

Add one unsupported command test near the other `readProviderUsage` error tests:

```ts
  it("classifies unsupported provider commands from older ccusage versions", async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error("Unknown command: opencode"));

    await expect(readProviderUsage("opencode", { runCommand })).rejects.toMatchObject({
      name: "UnsupportedCcusageProviderError",
      provider: "opencode",
      message: "ccusage does not support OpenCode usage in the installed version.",
    });
  });
```

- [ ] **Step 2: Run CLI adapter tests and verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ccusage.test.ts
```

Expected: FAIL because `readProviderUsage` and `buildCcusageArgs` only accept `claude_code | codex`.

- [ ] **Step 3: Implement provider command mapping and unsupported command classification**

In `packages/cli/src/ccusage.ts`, change the shared import:

```ts
import { formatProvider, providerMetadata, type Provider } from "@token-burn/shared";
```

Replace:

```ts
type CcusageProvider = Extract<Provider, "claude_code" | "codex">;
```

with:

```ts
type CcusageProvider = Provider;
```

Replace `UnsupportedCcusageProviderError` with:

```ts
export class UnsupportedCcusageProviderError extends Error {
  readonly provider: CcusageProvider;

  constructor(provider: CcusageProvider) {
    super(`ccusage does not support ${formatProvider(provider)} usage in the installed version.`);
    this.name = "UnsupportedCcusageProviderError";
    this.provider = provider;
  }
}
```

In `readProviderUsage`, wrap the primary run command with unsupported-command handling:

```ts
  try {
    result = await runCommand("ccusage", buildCcusageArgs(provider, false, window));
  } catch (error) {
    if (isUnsupportedProviderCommandError(error, provider)) {
      throw new UnsupportedCcusageProviderError(provider);
    }

    if (provider !== "claude_code" || !isUnsupportedBreakdownError(error)) {
      throw error;
    }

    result = await runCommand("ccusage", buildCcusageArgs(provider, true, window));
  }
```

Replace `buildCcusageArgs` with:

```ts
export function buildCcusageArgs(provider: CcusageProvider, fallback = false, window?: ProviderUsageWindow): string[] {
  const windowArgs = buildWindowArgs(window);
  const args = [providerMetadata[provider].ccusageCommand, "daily", "--json", "--timezone", "UTC", ...windowArgs];

  if (provider === "claude_code" && !fallback) {
    return [...args, "--breakdown"];
  }

  return args;
}
```

Add this helper after `isUnsupportedBreakdownError`:

```ts
function isUnsupportedProviderCommandError(error: unknown, provider: CcusageProvider): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const command = providerMetadata[provider].ccusageCommand.toLowerCase();

  return (
    normalized.includes(`unknown command: ${command}`) ||
    normalized.includes(`unknown command '${command}'`) ||
    normalized.includes(`unrecognized command: ${command}`) ||
    normalized.includes(`invalid command: ${command}`) ||
    (normalized.includes(command) &&
      (normalized.includes("unknown command") ||
        normalized.includes("unrecognized command") ||
        normalized.includes("invalid command")))
  );
}
```

- [ ] **Step 4: Run CLI adapter tests and verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ccusage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit CLI adapter changes**

```bash
git add packages/cli/src/ccusage.ts packages/cli/src/ccusage.test.ts
git commit -m "feat: map all ccusage provider commands"
```

## Task 3: Sync Collection Iteration And Provider Skips

**Files:**
- Modify: `packages/cli/src/sync-collection.ts`
- Modify: `packages/cli/src/sync-collection.test.ts`

- [ ] **Step 1: Write failing sync collection tests**

In `packages/cli/src/sync-collection.test.ts`, add:

```ts
import { providers } from "@token-burn/shared";
```

In the first test, replace the final `expect(readProviderUsageCalls).toEqual(...)` with:

```ts
    expect(readProviderUsageCalls).toEqual(
      providers.map((provider) => ({
        provider,
        window:
          provider === "claude_code"
            ? { since: "2026-05-31", until: "2026-06-01" }
            : undefined,
      })),
    );
```

In the same test's `readProviderUsage` fake, keep the Claude branch and add an OpenCode branch before the Codex fallback:

```ts
        if (provider === "opencode") {
          return [
            {
              provider,
              date: "2026-05-31",
              tokenCategories: { input: 30, output: 5 },
              totalTokens: 35,
            },
          ];
        }
```

Then change the existing non-Claude fallback into an explicit Codex branch plus an empty fallback:

```ts
        if (provider === "codex") {
          return [
            {
              provider,
              date: "2026-05-31",
              tokenCategories: { input: 100, output: 25, cacheCreate: 0, cacheRead: 0 },
              tokenDetails: { reasoningOutput: 5 },
              totalTokens: 125,
              costUsd: 0.123456,
              costSource: "ccusage",
              costMetadata: { currency: "USD" },
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
            },
          ];
        }

        return [];
```

Update the result expectation:

```ts
    expect(result).toEqual({ submitted: 3, failedProviders: [], skippedProviders: [] });
```

Add the expected OpenCode submission between Claude and Codex:

```ts
      {
        token: "secret",
        payload: {
          provider: "opencode",
          date: "2026-05-31",
          tokenCategories: { input: 30, output: 5 },
          totalTokens: 35,
          ccusageVersion: "20.0.6",
          deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
          deviceName: "nayan-vps",
          cliVersion: "0.1.0",
          os: "linux",
          syncedAt: "2026-06-01T00:00:00.000Z",
        },
      },
```

After the missing Claude data test, add:

```ts
  it("classifies missing data for new providers as skipped", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readCcusageVersion: async () => "20.0.6",
      readProviderUsage: async (provider) => {
        if (provider === "opencode") {
          throw new Error("No valid OpenCode data directories found");
        }

        return [];
      },
    });

    expect(result.skippedProviders).toContainEqual({
      provider: "opencode",
      message: "No valid OpenCode data directories found",
    });
    expect(result.failedProviders).toEqual([]);
  });
```

- [ ] **Step 2: Run sync collection tests and verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync-collection.test.ts
```

Expected: FAIL because sync collection still iterates only two providers and only Claude missing data is skippable.

- [ ] **Step 3: Iterate shared providers and generalize missing-data skips**

In `packages/cli/src/sync-collection.ts`, change the import:

```ts
import { providers, syncPayloadSchema, type Provider, type SyncPayload, type SyncWindowsResponse } from "@token-burn/shared";
```

Delete:

```ts
const supportedProviders: Provider[] = ["claude_code", "codex"];
```

Replace the loop:

```ts
  for (const provider of supportedProviders) {
```

with:

```ts
  for (const provider of providers) {
```

Replace `isMissingClaudeDataError` calls with `isMissingProviderDataError`:

```ts
  if (isMissingProviderDataError(normalizedError)) {
    return new Error(trimTrailingPeriod(normalizedError.message));
  }
```

and:

```ts
  return isMissingProviderDataError(toError(error));
```

Replace `isMissingClaudeDataError` with:

```ts
function isMissingProviderDataError(error: Error): boolean {
  return (
    /No valid .+ data directories found/i.test(error.message) ||
    /No .+ usage data found/i.test(error.message)
  );
}
```

- [ ] **Step 4: Run sync collection tests and verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync-collection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit sync collection changes**

```bash
git add packages/cli/src/sync-collection.ts packages/cli/src/sync-collection.test.ts
git commit -m "feat: sync all shared providers"
```

## Task 4: Web Sync Windows And Member Usage Filters

**Files:**
- Modify: `apps/web/src/server/sync-windows.ts`
- Modify: `apps/web/src/server/sync-windows.test.ts`
- Modify: `apps/web/src/app/api/cli/sync-windows/route.test.ts`
- Modify: `apps/web/src/server/member-usage-query.test.ts`

- [ ] **Step 1: Write failing web sync-window and query tests**

In `apps/web/src/server/sync-windows.test.ts`, add:

```ts
import { providers } from "@token-burn/shared";
```

In `"returns UTC until and provider-specific since dates"`, replace the provider expectation with:

```ts
      providers: providers.map((provider) => {
        if (provider === "claude_code") return { provider, since: "2026-06-05" };
        if (provider === "codex") return { provider, since: "2026-06-06" };
        return { provider };
      }),
```

In `"ignores unknown providers and null syncedAt while preserving provider order"`, replace the provider expectation with:

```ts
      providers: providers.map((provider) =>
        provider === "claude_code" ? { provider, since: "2026-06-05" } : { provider },
      ),
```

In `apps/web/src/app/api/cli/sync-windows/route.test.ts`, add:

```ts
import { providers } from "@token-burn/shared";
```

Replace the route response provider expectation with:

```ts
      providers: providers.map((provider) =>
        provider === "codex" ? { provider, since: "2026-06-06" } : { provider },
      ),
```

In `apps/web/src/server/member-usage-query.test.ts`, update `"parses range, provider, model, and device params"` so the provider query includes a new provider:

```ts
        ["provider", "opencode"],
```

and expects:

```ts
        providers: ["codex", "claude_code", "opencode"],
```

Update the model query to include:

```ts
        ["model", "gemini:gemini-2.5-pro"],
```

and expects:

```ts
          { provider: "gemini", modelName: "gemini-2.5-pro" },
```

In `"encodes ranges, providers, models, and devices with the route grammar"`, add `"opencode"` to the provider filters and expected string:

```ts
        providers: ["codex", "claude_code", "opencode"],
```

```ts
      "range=7d&provider=codex&provider=claude_code&provider=opencode&device=device-1&device=device-2",
```

- [ ] **Step 2: Run focused web tests and record current behavior**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts src/app/api/cli/sync-windows/route.test.ts src/server/member-usage-query.test.ts
```

Expected: PASS if `sync-windows.ts` already derives everything from the shared provider registry. FAIL if the local provider guard still prevents expanded providers from appearing.

- [ ] **Step 3: Keep sync-window provider guard tied to shared providers**

In `apps/web/src/server/sync-windows.ts`, no behavior rewrite is required if it already imports `providers` and checks membership. Make the guard explicit and narrow:

```ts
function isProvider(value: string): value is Provider {
  return providers.includes(value as Provider);
}
```

This keeps unknown historical provider rows ignored while returning every current shared provider.

- [ ] **Step 4: Run focused web tests and verify pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts src/app/api/cli/sync-windows/route.test.ts src/server/member-usage-query.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit web sync/filter changes**

```bash
git add apps/web/src/server/sync-windows.ts apps/web/src/server/sync-windows.test.ts apps/web/src/app/api/cli/sync-windows/route.test.ts apps/web/src/server/member-usage-query.test.ts
git commit -m "feat: expose all provider sync windows"
```

## Task 5: Member Usage Provider Labels

**Files:**
- Modify: `apps/web/src/components/member-usage-charts.tsx`
- Modify: `apps/web/src/components/member-usage-charts.test.tsx`

- [ ] **Step 1: Write failing provider label tests**

In `apps/web/src/components/member-usage-charts.test.tsx`, add a test after `"keeps breakdown row box styling stable when selected"`:

```tsx
  it("renders readable labels for expanded providers", () => {
    render(
      <MemberUsageCharts
        detail={{
          ...detail,
          providers: [
            { provider: "opencode", totalTokens: 4000, totalCostUsd: 4 },
            { provider: "copilot", totalTokens: 3000, totalCostUsd: 3 },
            { provider: "gemini", totalTokens: 2000, totalCostUsd: 2 },
          ],
          models: [
            { provider: "opencode", modelName: "gpt-oss", totalTokens: 4000, totalCostUsd: 4 },
          ],
        }}
      />,
    );

    const providersSection = sectionForHeading("Providers");

    expect(within(providersSection).getByRole("button", { name: /OpenCode/ })).toBeTruthy();
    expect(within(providersSection).getByRole("button", { name: /GitHub Copilot CLI/ })).toBeTruthy();
    expect(within(providersSection).getByRole("button", { name: /Gemini CLI/ })).toBeTruthy();
  });
```

- [ ] **Step 2: Run member usage chart tests and verify failure**

Run:

```bash
pnpm --filter @token-burn/web test -- src/components/member-usage-charts.test.tsx
```

Expected: FAIL because local `formatProvider` renders every non-Claude provider as `Codex`.

- [ ] **Step 3: Use shared provider formatting in charts**

In `apps/web/src/components/member-usage-charts.tsx`, update the shared import near the top:

```ts
import { formatProvider, formatTokens, formatUsd, type MemberUsageDetail } from "@token-burn/shared";
```

Delete the local function at the bottom:

```ts
function formatProvider(provider: MemberUsageDetail["providers"][number]["provider"]): string {
  if (provider === "claude_code") return "Claude Code";
  return "Codex";
}
```

Keep all existing `formatProvider(item.provider)` call sites unchanged.

- [ ] **Step 4: Run member usage chart tests and verify pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/components/member-usage-charts.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit label changes**

```bash
git add apps/web/src/components/member-usage-charts.tsx apps/web/src/components/member-usage-charts.test.tsx
git commit -m "feat: label expanded providers"
```

## Task 6: User-Facing Wording

**Files:**
- Modify: `README.md`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Update README product description**

In `README.md`, replace:

```md
Token Burn is a private-invite leaderboard for aggregate Claude Code and Codex usage. The web app shows member totals, and the `token-burn` CLI syncs local daily usage totals from each member's machine.
```

with:

```md
Token Burn is a private-invite leaderboard for aggregate coding-agent token usage reported by `ccusage`. The web app shows member totals, and the `token-burn` CLI syncs local daily usage totals from each member's machine.
```

- [ ] **Step 2: Update CLI package description**

In `packages/cli/package.json`, replace:

```json
  "description": "CLI for syncing Claude Code and Codex usage to Token Burn.",
```

with:

```json
  "description": "CLI for syncing ccusage coding-agent usage to Token Burn.",
```

- [ ] **Step 3: Commit wording changes**

```bash
git add README.md packages/cli/package.json
git commit -m "docs: describe ccusage source support"
```

## Task 7: Final Verification

**Files:**
- Verify all modified files

- [ ] **Step 1: Run focused shared tests**

Run:

```bash
pnpm --filter @token-burn/shared test -- src/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused CLI tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ccusage.test.ts src/sync-collection.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run focused web tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/sync-windows.test.ts src/app/api/cli/sync-windows/route.test.ts src/server/member-usage-query.test.ts src/components/member-usage-charts.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run workspace typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full workspace test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Inspect final git status**

Run:

```bash
git status --short
```

Expected: only unrelated pre-existing local edits remain, or a clean tree if those edits were handled separately. Do not revert unrelated files.
