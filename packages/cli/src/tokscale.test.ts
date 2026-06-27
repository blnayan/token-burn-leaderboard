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
