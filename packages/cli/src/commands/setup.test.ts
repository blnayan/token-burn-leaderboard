import type { CliConfig } from "../config.js";
import { describe, expect, it, vi } from "vitest";

import { runSetup } from "./setup.js";

describe("runSetup", () => {
  it("runs login, sync, and scheduler install in order when no reusable config exists", async () => {
    const events: string[] = [];
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test/",
      readConfig: async () => null,
      validateAuth: async () => {
        events.push("validate");
        return true;
      },
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
    expect(log).toHaveBeenCalledWith("Login complete.");
    expect(log).toHaveBeenCalledWith(
      "Setup complete. Automatic sync will run on quarter-hour boundaries.",
    );
  });

  it("skips login and continues setup when same-server auth validates", async () => {
    const events: string[] = [];
    const login = vi.fn(async () => {
      events.push("login");
    });
    const validateAuth = vi.fn(async () => {
      events.push("validate");
      return true;
    });
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test///",
      readConfig: async () => config({ serverUrl: "https://token-burn.test/", token: "tok_valid" }),
      validateAuth,
      login,
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async ({ dryRun }) => {
        events.push(`install:${dryRun}`);
      },
      log,
    });

    expect(validateAuth).toHaveBeenCalledWith({
      serverUrl: "https://token-burn.test",
      token: "tok_valid",
    });
    expect(login).not.toHaveBeenCalled();
    expect(events).toEqual(["validate", "sync", "install:false"]);
    expect(log).toHaveBeenCalledWith("Existing authentication is valid.");
    expect(log).not.toHaveBeenCalledWith("Login complete.");
  });

  it("runs login when same-server auth is rejected", async () => {
    const events: string[] = [];

    await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_invalid" }),
      validateAuth: async () => {
        events.push("validate");
        return false;
      },
      login: async ({ serverUrl }) => {
        events.push(`login:${serverUrl}`);
      },
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async ({ dryRun }) => {
        events.push(`install:${dryRun}`);
      },
      log: vi.fn(),
    });

    expect(events).toEqual(["validate", "login:https://token-burn.test", "sync", "install:false"]);
  });

  it("runs login without validation when config has no token", async () => {
    const validateAuth = vi.fn(async () => true);
    const login = vi.fn(async () => undefined);

    await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => config({ serverUrl: "https://token-burn.test", token: undefined }),
      validateAuth,
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(validateAuth).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test" });
  });

  it("runs login without validation when config server differs from the selected server", async () => {
    const validateAuth = vi.fn(async () => true);
    const login = vi.fn(async () => undefined);

    await runSetup({
      serverUrl: "https://selected-token-burn.test/",
      readConfig: async () => config({ serverUrl: "https://saved-token-burn.test", token: "tok_saved" }),
      validateAuth,
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(validateAuth).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith({ serverUrl: "https://selected-token-burn.test" });
  });

  it("propagates validation non-auth failures before sync or scheduler install", async () => {
    const sync = vi.fn(async () => undefined);
    const installScheduler = vi.fn(async () => undefined);

    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_valid" }),
        validateAuth: async () => {
          throw new Error("network unavailable");
        },
        login: async () => undefined,
        sync,
        installScheduler,
        log: vi.fn(),
      }),
    ).rejects.toThrow("network unavailable");

    expect(sync).not.toHaveBeenCalled();
    expect(installScheduler).not.toHaveBeenCalled();
  });

  it("stops when login fails", async () => {
    const sync = vi.fn(async () => undefined);
    const installScheduler = vi.fn(async () => undefined);

    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => null,
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

  it("still attempts scheduler install when first sync fails after valid auth", async () => {
    const installScheduler = vi.fn(async () => undefined);
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_valid" }),
      validateAuth: async () => true,
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
    expect(log).toHaveBeenCalledWith(
      "Automatic sync was still installed or refreshed and will retry on quarter-hour boundaries.",
    );
  });

  it("reports scheduler install failure with existing retry guidance", async () => {
    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => config({ serverUrl: "https://token-burn.test", token: "tok_valid" }),
        validateAuth: async () => true,
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

function config(overrides: Partial<CliConfig>): CliConfig {
  return {
    serverUrl: "https://token-burn.test",
    token: "tok_default",
    ...overrides,
  };
}
