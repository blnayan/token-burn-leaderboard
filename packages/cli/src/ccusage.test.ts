import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UnsupportedCcusageProviderError,
  buildCcusageArgs,
  normalizeCcusageDailyRows,
  readProviderUsage,
} from "./ccusage.js";

const tempDirs: string[] = [];

async function createFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "token-burn-ccusage-fixture-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("normalizeCcusageDailyRows", () => {
  it("normalizes common daily token fields into shared token categories", () => {
    const rows = normalizeCcusageDailyRows("codex", [
      {
        date: "2026-05-31",
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationTokens: 50,
        cacheReadTokens: 25,
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: {
          input: 100,
          output: 200,
          cacheCreate: 50,
          cacheRead: 25,
        },
        totalTokens: 375,
      },
    ]);
  });

  it("normalizes snake_case and short token aliases", () => {
    const rows = normalizeCcusageDailyRows("claude_code", [
      {
        date: "2026-05-31",
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_tokens: 50,
        cache_read_tokens: 25,
      },
      {
        date: "2026-06-01",
        input: 300,
        output: 400,
        cacheCreateTokens: 75,
        cacheReadTokens: 35,
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "claude_code",
        date: "2026-05-31",
        tokenCategories: {
          input: 100,
          output: 200,
          cacheCreate: 50,
          cacheRead: 25,
        },
        totalTokens: 375,
      },
      {
        provider: "claude_code",
        date: "2026-06-01",
        tokenCategories: {
          input: 300,
          output: 400,
          cacheCreate: 75,
          cacheRead: 35,
        },
        totalTokens: 810,
      },
    ]);
  });

  it("defaults missing token fields to zero", () => {
    const rows = normalizeCcusageDailyRows("codex", [
      {
        date: "2026-05-31",
        inputTokens: 100,
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: {
          input: 100,
          output: 0,
          cacheCreate: 0,
          cacheRead: 0,
        },
        totalTokens: 100,
      },
    ]);
  });

  it("normalizes latest Codex daily token fields", () => {
    const rows = normalizeCcusageDailyRows("codex", [
      {
        cachedInputTokens: 478_876_672,
        date: "2026-06-01",
        inputTokens: 13_561_893,
        outputTokens: 1_446_779,
        totalTokens: 493_885_344,
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "codex",
        date: "2026-06-01",
        tokenCategories: {
          input: 13_561_893,
          output: 1_446_779,
          cacheCreate: 0,
          cacheRead: 478_876_672,
        },
        totalTokens: 493_885_344,
      },
    ]);
  });

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
            costUSD: 0.42,
            inputTokens: 100,
            isFallback: false,
            outputTokens: 50,
            reasoningOutputTokens: 20,
            totalTokens: 1000,
          },
        },
        outputTokens: 50,
        reasoningOutputTokens: 20,
        sessionId: "session-123",
        projectPath: "/tmp/project",
        prompt: "summarize the project",
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
            costUsd: 0.42,
            metadata: {
              isFallback: false,
            },
          },
        ],
      },
    ]);
  });

  it("normalizes array-shaped Codex model usage rows", () => {
    const rows = normalizeCcusageDailyRows("codex", [
      {
        cachedInputTokens: 850,
        costUSD: 1.234567,
        date: "2026-06-01",
        inputTokens: 100,
        models: [
          {
            model: "gpt-5.5",
            cachedInputTokens: 850,
            costUSD: 0.42,
            inputTokens: 100,
            isFallback: false,
            outputTokens: 50,
            reasoningOutputTokens: 20,
            totalTokens: 1000,
          },
        ],
        outputTokens: 50,
        reasoningOutputTokens: 20,
        totalTokens: 1000,
      },
    ]);

    expect(rows).toMatchObject([
      {
        provider: "codex",
        date: "2026-06-01",
        totalTokens: 1000,
        models: [
          {
            modelName: "gpt-5.5",
            totalTokens: 1000,
            metadata: {
              isFallback: false,
            },
          },
        ],
      },
    ]);
  });

  it("excludes unexpected fields from source snapshots", () => {
    const rows = normalizeCcusageDailyRows("codex", [
      {
        costUSD: 0.5,
        date: "2026-06-01",
        inputTokens: 100,
        outputTokens: 50,
        prompt: "write some code",
        projectPath: "/home/user/private-project",
        sessionId: "abc123",
        totalTokens: 150,
      },
    ]);

    expect(rows[0]?.sourceSnapshot).toEqual({
      costUSD: 0.5,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it("normalizes ccusage modelBreakdowns into model usage rows", () => {
    const rows = normalizeCcusageDailyRows("claude_code", [
      {
        date: "2026-06-01",
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 10,
        cacheReadTokens: 20,
        totalTokens: 180,
        totalCost: 0.42,
        modelBreakdowns: {
          "claude-sonnet-4": {
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
            totalTokens: 180,
            totalCost: 0.42,
          },
        },
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "claude_code",
        date: "2026-06-01",
        tokenCategories: {
          input: 100,
          output: 50,
          cacheCreate: 10,
          cacheRead: 20,
        },
        totalTokens: 180,
        costUsd: 0.42,
        costSource: "ccusage",
        sourceSnapshot: {
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          inputTokens: 100,
          outputTokens: 50,
          totalCost: 0.42,
          totalTokens: 180,
        },
        models: [
          {
            modelName: "claude-sonnet-4",
            tokenCategories: {
              input: 100,
              output: 50,
              cacheCreate: 10,
              cacheRead: 20,
            },
            totalTokens: 180,
            costUsd: 0.42,
          },
        ],
      },
    ]);
  });

  it("normalizes array-shaped ccusage modelBreakdowns into model usage rows", () => {
    const rows = normalizeCcusageDailyRows("claude_code", [
      {
        date: "2026-06-01",
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 10,
        cacheReadTokens: 20,
        totalTokens: 180,
        totalCost: 0.42,
        modelBreakdowns: [
          {
            modelName: "claude-sonnet-4",
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
            totalTokens: 180,
            totalCost: 0.42,
          },
        ],
      },
    ]);

    expect(rows).toMatchObject([
      {
        provider: "claude_code",
        date: "2026-06-01",
        totalTokens: 180,
        models: [
          {
            modelName: "claude-sonnet-4",
            totalTokens: 180,
          },
        ],
      },
    ]);
  });

  it("keeps provider totals when optional model breakdowns are malformed", () => {
    const rows = normalizeCcusageDailyRows("claude_code", [
      {
        date: "2026-06-01",
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 10,
        cacheReadTokens: 20,
        totalTokens: 180,
        totalCost: 0.42,
        modelBreakdowns: [
          {
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
            totalTokens: 180,
          },
        ],
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "claude_code",
        date: "2026-06-01",
        tokenCategories: {
          input: 100,
          output: 50,
          cacheCreate: 10,
          cacheRead: 20,
        },
        totalTokens: 180,
        costUsd: 0.42,
        costSource: "ccusage",
        sourceSnapshot: {
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          inputTokens: 100,
          outputTokens: 50,
          totalCost: 0.42,
          totalTokens: 180,
        },
      },
    ]);
  });
});

describe("buildCcusageArgs", () => {
  it("uses the supported UTC daily JSON report for Claude Code", () => {
    expect(buildCcusageArgs("claude_code")).toEqual([
      "claude",
      "daily",
      "--json",
      "--timezone",
      "UTC",
      "--breakdown",
    ]);
  });

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

  it("treats UTC as an invariant instead of reading TOKEN_BURN_TIMEZONE", () => {
    vi.stubEnv("TOKEN_BURN_TIMEZONE", "America/New_York");

    expect(buildCcusageArgs("claude_code")).toEqual([
      "claude",
      "daily",
      "--json",
      "--timezone",
      "UTC",
      "--breakdown",
    ]);
  });

  it("uses the supported UTC daily JSON report for Codex", () => {
    expect(buildCcusageArgs("codex")).toEqual(["codex", "daily", "--json", "--timezone", "UTC"]);
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
});

describe("readProviderUsage", () => {
  it("passes Claude Code UTC daily JSON args to ccusage", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([
        {
          date: "2026-05-31",
          inputTokens: 100,
        },
      ]),
      stderr: "",
    });

    await readProviderUsage("claude_code", { runCommand });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand.mock.calls[0]?.[1]).toEqual(["claude", "daily", "--json", "--timezone", "UTC", "--breakdown"]);
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

  it("does not fall back after a generic Claude primary failure", async () => {
    const error = new Error("Unable to load ccusage config.");
    const runCommand = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce({
      stdout: JSON.stringify([
        {
          date: "2026-06-01",
          inputTokens: 10,
        },
      ]),
      stderr: "",
    });

    await expect(readProviderUsage("claude_code", { runCommand })).rejects.toBe(error);

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand.mock.calls[0]?.[1]).toEqual(["claude", "daily", "--json", "--timezone", "UTC", "--breakdown"]);
  });

  it("passes Codex UTC daily JSON args to ccusage", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        daily: [
          {
            cachedInputTokens: 100,
            date: "2026-06-01",
            inputTokens: 25,
            outputTokens: 5,
          },
        ],
      }),
      stderr: "",
    });

    await readProviderUsage("codex", { runCommand });

    expect(runCommand).toHaveBeenCalledOnce();
    expect(runCommand.mock.calls[0]?.[1]).toEqual(["codex", "daily", "--json", "--timezone", "UTC"]);
  });

  it("normalizes daily rows from object output", async () => {
    const runCommand = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        daily: [
          {
            date: "2026-05-31",
            input_tokens: 100,
            output_tokens: 50,
          },
        ],
      }),
      stderr: "",
    });

    await expect(readProviderUsage("claude_code", { runCommand })).resolves.toEqual([
      {
        provider: "claude_code",
        date: "2026-05-31",
        tokenCategories: {
          input: 100,
          output: 50,
          cacheCreate: 0,
          cacheRead: 0,
        },
        totalTokens: 150,
      },
    ]);
  });

  it("reads object-shaped daily rows from TOKEN_BURN_E2E_FIXTURE_DIR without invoking ccusage", async () => {
    const fixtureDir = await createFixtureDir();
    const runCommand = vi.fn().mockRejectedValue(new Error("ccusage should not be invoked in fixture mode"));

    await writeFile(
      join(fixtureDir, "claude_code.json"),
      JSON.stringify({
        daily: [
          {
            cacheCreationTokens: 30,
            cacheReadTokens: 40,
            costMetadata: { currency: "USD", pricingVersion: "e2e-claude" },
            costUSD: 0.123456,
            date: "2026-06-03",
            inputTokens: 10,
            models: {
              "claude-sonnet-4": {
                cacheCreationTokens: 30,
                cacheReadTokens: 40,
                costUSD: 0.1,
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 100,
              },
            },
            outputTokens: 20,
            totalTokens: 100,
          },
        ],
      }),
      "utf8",
    );
    vi.stubEnv("TOKEN_BURN_E2E_FIXTURE_DIR", fixtureDir);

    await expect(readProviderUsage("claude_code", { runCommand })).resolves.toEqual([
      {
        provider: "claude_code",
        date: "2026-06-03",
        tokenCategories: {
          input: 10,
          output: 20,
          cacheCreate: 30,
          cacheRead: 40,
        },
        totalTokens: 100,
        costUsd: 0.123456,
        costSource: "ccusage",
        costMetadata: {
          currency: "USD",
          pricingVersion: "e2e-claude",
        },
        sourceSnapshot: {
          cacheCreationTokens: 30,
          cacheReadTokens: 40,
          costUSD: 0.123456,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 100,
        },
        models: [
          {
            modelName: "claude-sonnet-4",
            tokenCategories: {
              input: 10,
              output: 20,
              cacheCreate: 30,
              cacheRead: 40,
            },
            totalTokens: 100,
            costUsd: 0.1,
          },
        ],
      },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("reads array-shaped fixture rows for Codex", async () => {
    const fixtureDir = await createFixtureDir();
    const runCommand = vi.fn().mockRejectedValue(new Error("ccusage should not be invoked in fixture mode"));

    await writeFile(
      join(fixtureDir, "codex.json"),
      JSON.stringify([
        {
          cachedInputTokens: 300,
          costMetadata: { currency: "USD", pricingVersion: "e2e-codex" },
          costUSD: 0.654321,
          date: "2026-06-03",
          inputTokens: 100,
          models: [
            {
              cachedInputTokens: 300,
              costUSD: 0.4,
              inputTokens: 100,
              isFallback: false,
              model: "gpt-5.5",
              outputTokens: 200,
              reasoningOutputTokens: 50,
              totalTokens: 600,
            },
          ],
          outputTokens: 200,
          reasoningOutputTokens: 50,
          totalTokens: 600,
        },
      ]),
      "utf8",
    );
    vi.stubEnv("TOKEN_BURN_E2E_FIXTURE_DIR", fixtureDir);

    await expect(readProviderUsage("codex", { runCommand })).resolves.toMatchObject([
      {
        provider: "codex",
        date: "2026-06-03",
        tokenCategories: {
          input: 100,
          output: 200,
          cacheCreate: 0,
          cacheRead: 300,
        },
        tokenDetails: {
          reasoningOutput: 50,
        },
        totalTokens: 600,
        costUsd: 0.654321,
        costSource: "ccusage",
        costMetadata: {
          currency: "USD",
          pricingVersion: "e2e-codex",
        },
        models: [
          {
            modelName: "gpt-5.5",
            totalTokens: 600,
            costUsd: 0.4,
            metadata: {
              isFallback: false,
            },
          },
        ],
      },
    ]);
    expect(runCommand).not.toHaveBeenCalled();
  });
});
