import { describe, expect, it, vi } from "vitest";

import { runSetup } from "./setup.js";

describe("runSetup", () => {
  it("runs login, sync, and scheduler install in order", async () => {
    const events: string[] = [];
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test",
      login: async ({ serverUrl }) => {
        events.push(`login:${serverUrl}`);
      },
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async ({ dryRun }) => {
        events.push(`install:${dryRun}`);
      },
      log,
    });

    expect(events).toEqual(["login:https://token-burn.test", "sync", "install:false"]);
    expect(log).toHaveBeenCalledWith("Setup complete. Automatic sync will run every 15 minutes.");
  });

  it("passes --server-url through to login", async () => {
    const login = vi.fn(async () => undefined);

    await runSetup({
      serverUrl: "https://custom-token-burn.test",
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(login).toHaveBeenCalledWith({ serverUrl: "https://custom-token-burn.test" });
  });

  it("stops when login fails", async () => {
    const sync = vi.fn(async () => undefined);
    const installScheduler = vi.fn(async () => undefined);

    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        login: async () => {
          throw new Error("Login session expired before approval.");
        },
        sync,
        installScheduler,
        log: vi.fn(),
      }),
    ).rejects.toThrow("Login session expired before approval.");

    expect(sync).not.toHaveBeenCalled();
    expect(installScheduler).not.toHaveBeenCalled();
  });

  it("attempts scheduler install when first sync fails after login", async () => {
    const installScheduler = vi.fn(async () => undefined);
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test",
      login: async () => undefined,
      sync: async () => {
        throw new Error("All supported providers failed: codex: fixture missing.");
      },
      installScheduler,
      log,
    });

    expect(installScheduler).toHaveBeenCalledWith({ dryRun: false });
    expect(log).toHaveBeenCalledWith(
      "First sync failed: All supported providers failed: codex: fixture missing.",
    );
    expect(log).toHaveBeenCalledWith("Automatic sync was still installed and will retry every 15 minutes.");
  });

  it("reports scheduler install failure clearly", async () => {
    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        login: async () => undefined,
        sync: async () => undefined,
        installScheduler: async () => {
          throw new Error("systemd user timer unavailable");
        },
        log: vi.fn(),
      }),
    ).rejects.toThrow(
      "Setup authenticated and attempted the first sync, but automatic sync was not installed: systemd user timer unavailable. Retry with npx @blnayan/token-burn@latest install-scheduler.",
    );
  });
});
