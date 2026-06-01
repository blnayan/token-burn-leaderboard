import { describe, expect, it } from "vitest";

import type { CliConfig } from "./config.js";
import { syncUsage } from "./sync.js";

describe("syncUsage", () => {
  it("throws a helpful login message when no token is configured", async () => {
    await expect(
      syncUsage({
        readConfig: async () => ({ serverUrl: "https://token-burn.test" }),
      }),
    ).rejects.toThrow("Run token-burn login --server https://token-burn.test to authenticate.");
  });

  it("posts payloads and writes successful lastSync after a successful sync", async () => {
    const writes: CliConfig[] = [];
    const posts: Array<{ url: string; body: unknown; token?: string }> = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      postJson: async (url, body, token) => {
        posts.push({ url, body, token });
        return { ok: true };
      },
      readProviderUsage: async (provider) => [
        {
          provider,
          date: "2026-05-31",
          tokenCategories: { input: provider === "codex" ? 100 : 50, output: 25 },
          totalTokens: provider === "codex" ? 125 : 75,
        },
      ],
      readCcusageVersion: async () => "16.2.5",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      log: (message) => {
        logs.push(message);
      },
    });

    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      url: "https://token-burn.test/api/sync",
      token: "secret",
    });
    expect(posts.map((post) => post.body)).toEqual([
      {
        provider: "claude_code",
        date: "2026-05-31",
        tokenCategories: { input: 50, output: 25 },
        totalTokens: 75,
        cliVersion: "0.1.0",
        ccusageVersion: "16.2.5",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: { input: 100, output: 25 },
        totalTokens: 125,
        cliVersion: "0.1.0",
        ccusageVersion: "16.2.5",
        os: "linux",
        syncedAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        lastSync: {
          ok: true,
          message: "Submitted 2 usage rows.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    expect(logs).toEqual(["Submitted 2 usage rows."]);
  });

  it("records failed lastSync but does not throw when at least one provider submits", async () => {
    const writes: CliConfig[] = [];
    const logs: string[] = [];

    await syncUsage({
      readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
      writeConfig: async (config) => {
        writes.push(config);
      },
      postJson: async () => ({ ok: true }),
      readProviderUsage: async (provider) => {
        if (provider === "claude_code") {
          throw new Error("ccusage claude failed");
        }

        return [
          {
            provider,
            date: "2026-05-31",
            tokenCategories: { input: 100 },
            totalTokens: 100,
          },
        ];
      },
      readCcusageVersion: async () => "16.2.5",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      platform: "linux",
      cliVersion: "0.1.0",
      log: (message) => {
        logs.push(message);
      },
    });

    expect(writes).toEqual([
      {
        serverUrl: "https://token-burn.test",
        token: "secret",
        lastSync: {
          ok: false,
          message: "Submitted 1 usage row. Failed providers: claude_code: ccusage claude failed.",
          at: "2026-06-01T00:00:00.000Z",
        },
      },
    ]);
    expect(logs).toEqual(["Submitted 1 usage row. Failed providers: claude_code: ccusage claude failed."]);
  });
});
