import { describe, expect, it, vi } from "vitest";

import {
  UnsupportedCcusageProviderError,
  buildCcusageArgs,
  normalizeCcusageDailyRows,
  readProviderUsage,
} from "./ccusage.js";

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
});

describe("buildCcusageArgs", () => {
  it("uses the supported UTC daily JSON report for Claude Code", () => {
    expect(buildCcusageArgs("claude_code", { TOKEN_BURN_TIMEZONE: "UTC" })).toEqual([
      "daily",
      "--json",
      "--timezone",
      "UTC",
    ]);
  });

  it("defaults the Token Burn timezone to UTC", () => {
    expect(buildCcusageArgs("claude_code", {})).toEqual(["daily", "--json", "--timezone", "UTC"]);
  });

  it("rejects non-UTC Token Burn timezones", () => {
    expect(() => buildCcusageArgs("claude_code", { TOKEN_BURN_TIMEZONE: "America/New_York" })).toThrow(
      "TOKEN_BURN_TIMEZONE must be UTC.",
    );
  });

  it("rejects Codex because installed ccusage does not expose a Codex report", () => {
    expect(() => buildCcusageArgs("codex")).toThrow("ccusage does not support Codex usage in the installed version.");
    expect(() => buildCcusageArgs("codex")).toThrow(UnsupportedCcusageProviderError);
  });
});

describe("readProviderUsage", () => {
  it("does not invoke the command runner for unsupported Codex usage", async () => {
    const runCommand = vi.fn();

    await expect(readProviderUsage("codex", { runCommand })).rejects.toThrow(
      "ccusage does not support Codex usage in the installed version.",
    );
    expect(runCommand).not.toHaveBeenCalled();
  });

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
    expect(runCommand.mock.calls[0]?.[1]).toEqual(["daily", "--json", "--timezone", "UTC"]);
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
