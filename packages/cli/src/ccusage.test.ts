import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UnsupportedCcusageProviderError,
  buildCcusageArgs,
  normalizeCcusageDailyRows,
  readProviderUsage,
} from "./ccusage.js";

afterEach(() => {
  vi.unstubAllEnvs();
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
});
