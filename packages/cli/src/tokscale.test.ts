import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { providers, type Provider } from "@token-burn/shared";
import {
  UnsupportedTokscaleProviderError,
  buildTokscaleGraphArgs,
  normalizeTokscaleGraph,
  readProviderUsage,
} from "./tokscale.js";

const tempDirs: string[] = [];
const providerClientPairs = [
  ["claude_code", "claude"],
  ["codex", "codex"],
  ["opencode", "opencode"],
  ["amp", "amp"],
  ["droid", "droid"],
  ["codebuff", "codebuff"],
  ["hermes", "hermes"],
  ["pi", "pi"],
  ["goose", "goose"],
  ["kilo", "kilo"],
  ["copilot", "copilot"],
  ["gemini", "gemini"],
  ["kimi", "kimi"],
  ["qwen", "qwen"],
  ["openclaw", "openclaw"],
  ["roocode", "roocode"],
  ["kilocode", "kilocode"],
  ["mux", "mux"],
  ["zed", "zed"],
  ["kiro", "kiro"],
  ["cline", "cline"],
  ["gjc", "gjc"],
  ["grok", "grok"],
  ["jcode", "jcode"],
  ["micode", "micode"],
  ["commandcode", "commandcode"],
  ["antigravity_cli", "antigravity-cli"],
  ["junie", "junie"],
  ["zcode", "zcode"],
] as const satisfies ReadonlyArray<readonly [Provider, string]>;

async function createFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "token-burn-tokscale-fixture-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:module");
  vi.resetModules();
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
    expect(providerClientPairs.map(([provider]) => provider)).toEqual(providers);

    for (const [provider, client] of providerClientPairs) {
      const args = buildTokscaleGraphArgs(provider);
      const clientIndex = args.indexOf("--client");
      expect(args[0]).toBe("graph");
      expect(args).toContain("--client");
      expect(args[clientIndex + 1]).toBe(client);
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
              tokens: { input: 60, output: 40, cacheRead: 20, cacheWrite: 10, reasoning: 0 },
              cost: 0.12,
              messages: 1,
            },
            {
              client: "codex",
              modelId: "gpt-5",
              providerId: "openai",
              tokens: { input: 20, output: 30, cacheRead: 10, cacheWrite: 10, reasoning: 0 },
              cost: 0.08,
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
    expect(rows[0]?.costUsd).toBe(0.3);
    expect(rows[0]?.models).toHaveLength(2);
    expect(rows[0]?.models?.map((model) => model.modelName)).toEqual(["gpt-5", "gpt-5-mini"]);
    expect(rows[0]?.models?.find((model) => model.modelName === "gpt-5")).toMatchObject({
      tokenCategories: { input: 80, output: 70, cacheCreate: 20, cacheRead: 30 },
      totalTokens: 200,
      costUsd: 0.2,
    });
    expect(rows[0]?.models?.find((model) => model.modelName === "gpt-5-mini")).toMatchObject({
      tokenCategories: { input: 20, output: 30, cacheCreate: 30, cacheRead: 20 },
      totalTokens: 100,
      costUsd: 0.1,
    });
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
  it("resolves the package-local tokscale bin for the default command runner", async () => {
    vi.resetModules();

    const stdout = JSON.stringify({
      contributions: [
        {
          date: "2026-06-01",
          totals: { tokens: 10, cost: 0.01, messages: 1 },
          tokenBreakdown: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          clients: [],
        },
      ],
    });
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
        stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
      };
      child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      queueMicrotask(() => {
        child.stdout.emit("data", stdout);
        child.emit("close", 0);
      });
      return child;
    });
    const requireFromCli = Object.assign(
      vi.fn(() => ({
        bin: { tokscale: "dist/index.js" },
      })),
      {
        resolve: vi.fn(() => "/workspace/node_modules/tokscale/package.json"),
      },
    );

    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("node:module", () => ({
      createRequire: () => requireFromCli,
    }));

    const { readProviderUsage: readProviderUsageWithDefaultRunner } = await import("./tokscale.js");

    await expect(readProviderUsageWithDefaultRunner("codex")).resolves.toMatchObject([
      { provider: "codex", date: "2026-06-01", totalTokens: 10 },
    ]);
    expect(requireFromCli.resolve).toHaveBeenCalledWith("tokscale/package.json");
    expect(requireFromCli).toHaveBeenCalledWith("/workspace/node_modules/tokscale/package.json");
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [
        "/workspace/node_modules/tokscale/dist/index.js",
        "graph",
        "--client",
        "codex",
        "--no-spinner",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  });

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

    const rows = await readProviderUsage("claude_code", {
      runCommand,
      window: { since: "2026-06-01", until: "2026-06-01" },
    });

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
    expect(rows).toMatchObject([
      {
        provider: "claude_code",
        date: "2026-06-01",
        tokenCategories: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 },
        totalTokens: 10,
        costUsd: 0.01,
        costSource: "tokscale",
        models: [
          {
            modelName: "claude-sonnet-4",
            tokenCategories: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 },
            totalTokens: 10,
            costUsd: 0.01,
            metadata: { client: "claude", messages: 1, providerId: "anthropic" },
          },
        ],
      },
    ]);
  });

  it("reads provider fixture files from TOKEN_BURN_E2E_FIXTURE_DIR without invoking tokscale", async () => {
    const fixtureDir = await createFixtureDir();
    const runCommand = vi.fn().mockRejectedValue(new Error("tokscale should not be invoked in fixture mode"));

    await writeFile(
      join(fixtureDir, "claude_code.json"),
      JSON.stringify({
        contributions: [
          {
            date: "2026-06-01",
            totals: { tokens: 5, cost: 0.02, messages: 1 },
            tokenBreakdown: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
            clients: [
              {
                client: "claude",
                modelId: "claude-sonnet-4",
                providerId: "anthropic",
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

    await expect(readProviderUsage("claude_code", { runCommand })).resolves.toMatchObject([
      { provider: "claude_code", date: "2026-06-01", totalTokens: 5 },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("classifies unsupported tokscale clients", async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error("invalid value 'grok' for '--client <CLIENTS>'"));

    await expect(readProviderUsage("grok", { runCommand })).rejects.toEqual(
      new UnsupportedTokscaleProviderError("grok"),
    );
  });

  it("continues to classify singular unsupported-client messages", async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error("invalid value 'grok' for '--client <CLIENT>'"));

    await expect(readProviderUsage("grok", { runCommand })).rejects.toEqual(
      new UnsupportedTokscaleProviderError("grok"),
    );
  });

  it("normalizes tokscale no-local-data output into a skippable provider message", async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error("No data found for client codex"));

    await expect(readProviderUsage("codex", { runCommand })).rejects.toThrow("No Codex usage data found");
  });

  it("treats an empty full-history graph as missing local provider data", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ contributions: [] }),
      stderr: "",
    });

    await expect(readProviderUsage("codex", { runCommand })).rejects.toThrow("No Codex usage data found");
  });

  it("allows an empty graph inside a sync window", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ contributions: [] }),
      stderr: "",
    });

    await expect(
      readProviderUsage("codex", {
        runCommand,
        window: { since: "2026-06-01", until: "2026-06-02" },
      }),
    ).resolves.toEqual([]);
  });

  it("rejects unknown providers before invoking tokscale", async () => {
    const runCommand = vi.fn();
    const provider = "future_provider" as never;

    await expect(readProviderUsage(provider, { runCommand })).rejects.toEqual(
      new UnsupportedTokscaleProviderError(provider),
    );
    expect(runCommand).not.toHaveBeenCalled();
  });
});
