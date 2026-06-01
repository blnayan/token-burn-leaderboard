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
});
