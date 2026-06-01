import { describe, expect, it } from "vitest";

import { normalizeCcusageDailyRows } from "./ccusage.js";

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
