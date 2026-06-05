# Idempotent Setup Auth Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `token-burn setup` safe to rerun by validating reusable auth before skipping login and refreshing schedulers without duplicate Token Burn entries.

**Architecture:** Add a purpose-built web API route for CLI token validation, then teach the CLI setup command to validate matching local config before starting login. Keep scheduler reconciliation inside `packages/cli/src/scheduler.ts`, where Linux systemd success can remove a previous marked cron fallback block while macOS and Windows continue fixed-name refresh behavior.

**Tech Stack:** TypeScript, Node.js, Commander, Next.js route handlers, Prisma client mocks, Vitest, systemd user timers, cron, launchd, Windows `schtasks`.

---

## File Structure

- Create `apps/web/src/app/api/cli/auth/route.ts`: authenticated validation endpoint for saved CLI tokens.
- Create `apps/web/src/app/api/cli/auth/route.test.ts`: route tests for missing, invalid, expired/revoked/deleted, and valid tokens.
- Modify `packages/cli/src/http.ts`: add a small `getJson` helper plus an exported `HttpError` that exposes HTTP status for auth validation.
- Modify `packages/cli/src/commands/setup.ts`: read local config, validate same-server saved auth, skip login only when validation succeeds, and update setup copy to quarter-hour wording.
- Modify `packages/cli/src/commands/setup.test.ts`: cover auth reuse, auth fallback, validation hard failures, ordering, and wording.
- Modify `packages/cli/src/scheduler.ts`: remove marked cron fallback after Linux systemd install succeeds, and avoid crontab writes when no Token Burn cron block exists.
- Modify `packages/cli/src/scheduler.test.ts`: cover systemd cleanup, no-op cleanup, and existing cron fallback replacement behavior.

---

### Task 1: Add CLI Auth Validation Endpoint

**Files:**
- Create: `apps/web/src/app/api/cli/auth/route.test.ts`
- Create: `apps/web/src/app/api/cli/auth/route.ts`

- [ ] **Step 1: Write failing route tests**

Create `apps/web/src/app/api/cli/auth/route.test.ts`:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/server/cli-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/cli-auth")>("@/server/cli-auth");

  return {
    ...actual,
    hashSecret: vi.fn((value: string) => `hashed-${value}`),
  };
});

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";

import { GET } from "./route";

const prismaMock = prisma as unknown as {
  cliToken: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

const hashSecretMock = hashSecret as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/cli/auth", () => {
  beforeEach(() => {
    prismaMock.cliToken.findFirst.mockReset();
    hashSecretMock.mockClear();
  });

  it("returns unauthorized without a bearer token", async () => {
    const response = await GET(new NextRequest("https://token-burn.test/api/cli/auth"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(prismaMock.cliToken.findFirst).not.toHaveBeenCalled();
  });

  it("returns unauthorized when no valid CLI token exists", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue(null);

    const response = await GET(createAuthRequest("tb_missing"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(hashSecretMock).toHaveBeenCalledWith("tb_missing");
    expect(prismaMock.cliToken.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: "hashed-tb_missing",
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        member: {
          select: {
            displayName: true,
            username: true,
          },
        },
      },
    });
  });

  it("returns authenticated member data for a valid CLI token", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({
      member: {
        displayName: "Nayan",
        username: "blnayan",
      },
    });

    const response = await GET(createAuthRequest("tb_secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      member: {
        displayName: "Nayan",
        username: "blnayan",
      },
    });
  });
});

function createAuthRequest(token: string) {
  return new NextRequest("https://token-burn.test/api/cli/auth", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
}
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/api/cli/auth/route.test.ts
```

Expected: FAIL because `apps/web/src/app/api/cli/auth/route.ts` does not exist.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/cli/auth/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";

export async function GET(request: NextRequest) {
  const token = readBearerToken(request);
  if (!token) return unauthorized();

  const cliToken = await prisma.cliToken.findFirst({
    where: {
      tokenHash: hashSecret(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      member: {
        select: {
          displayName: true,
          username: true,
        },
      },
    },
  });

  if (!cliToken) return unauthorized();

  return NextResponse.json({
    authenticated: true,
    member: {
      displayName: cliToken.member.displayName,
      ...(cliToken.member.username ? { username: cliToken.member.username } : {}),
    },
  });
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

- [ ] **Step 4: Run route tests to verify pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/api/cli/auth/route.test.ts
```

Expected: PASS for all `GET /api/cli/auth` tests.

- [ ] **Step 5: Commit endpoint**

```bash
git add apps/web/src/app/api/cli/auth/route.ts apps/web/src/app/api/cli/auth/route.test.ts
git commit -m "feat(web): add cli auth validation endpoint"
```

---

### Task 2: Add CLI GET Helper With HTTP Status

**Files:**
- Modify: `packages/cli/src/http.ts`
- Test: `packages/cli/src/http.test.ts`

- [ ] **Step 1: Replace HTTP tests with failing GET helper coverage**

Replace `packages/cli/src/http.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { getJson, postJson } from "./http.js";

describe("http helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("postJson uses API error messages from JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "pollToken is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(postJson("https://token-burn.test/api", {})).rejects.toThrow("pollToken is required");
  });

  it("postJson reports HTTP status and body for non-JSON error responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service unavailable", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(postJson("https://token-burn.test/api", {})).rejects.toThrow(
      "HTTP 503 Service Unavailable: Service unavailable",
    );
  });

  it("getJson sends bearer auth and parses JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await expect(getJson<{ ok: boolean }>("https://token-burn.test/api/cli/auth", "tb_secret")).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/auth", {
      method: "GET",
      headers: {
        authorization: "Bearer tb_secret",
      },
    });
  });

  it("getJson exposes HTTP status on failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    await expect(getJson("https://token-burn.test/api/cli/auth", "tb_bad")).rejects.toMatchObject({
      name: "HttpError",
      message: "Unauthorized",
      status: 401,
    });
  });
});
```

- [ ] **Step 2: Run HTTP tests to verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/http.test.ts
```

Expected: FAIL because `getJson` is not exported.

- [ ] **Step 3: Implement `HttpError` and `getJson`**

Replace `packages/cli/src/http.ts` with:

```ts
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function getJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  return parseJsonResponse<T>(response);
}

export async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = parseJsonOrNull(text);

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : formatHttpError(response, text);
    throw new HttpError(message, response.status);
  }

  if (text && data === null) {
    throw new Error("Expected JSON response.");
  }

  return data as T;
}

function parseJsonOrNull(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function formatHttpError(response: Response, text: string): string {
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const body = text.trim();

  return body ? `${status}: ${body}` : status;
}
```

- [ ] **Step 4: Run HTTP tests to verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/http.test.ts
```

Expected: PASS for all HTTP helper tests.

- [ ] **Step 5: Commit HTTP helper**

```bash
git add packages/cli/src/http.ts packages/cli/src/http.test.ts
git commit -m "feat(cli): add authenticated get json helper"
```

---

### Task 3: Reuse Valid Auth In Setup

**Files:**
- Modify: `packages/cli/src/commands/setup.test.ts`
- Modify: `packages/cli/src/commands/setup.ts`

- [ ] **Step 1: Replace setup tests with auth-reuse coverage**

Replace `packages/cli/src/commands/setup.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";

import type { CliConfig } from "../config.js";
import { runSetup } from "./setup.js";

describe("runSetup", () => {
  it("runs login, sync, and scheduler install in order when no reusable config exists", async () => {
    const events: string[] = [];
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => null,
      validateAuth: async () => true,
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
    expect(log).toHaveBeenCalledWith("Setup complete. Automatic sync will run on quarter-hour boundaries.");
  });

  it("skips login when existing same-server auth validates", async () => {
    const events: string[] = [];
    const login = vi.fn(async () => {
      events.push("login");
    });
    const validateAuth = vi.fn(async () => true);
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test/",
      readConfig: async () => authConfig({ serverUrl: "https://token-burn.test" }),
      validateAuth,
      login,
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async () => {
        events.push("install");
      },
      log,
    });

    expect(validateAuth).toHaveBeenCalledWith({
      serverUrl: "https://token-burn.test",
      token: "tb_secret",
    });
    expect(login).not.toHaveBeenCalled();
    expect(events).toEqual(["sync", "install"]);
    expect(log).toHaveBeenCalledWith("Existing authentication is valid.");
    expect(log).not.toHaveBeenCalledWith("Login complete.");
  });

  it("runs login when existing same-server auth is rejected", async () => {
    const events: string[] = [];

    await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => authConfig({ serverUrl: "https://token-burn.test" }),
      validateAuth: async () => false,
      login: async () => {
        events.push("login");
      },
      sync: async () => {
        events.push("sync");
      },
      installScheduler: async () => {
        events.push("install");
      },
      log: vi.fn(),
    });

    expect(events).toEqual(["login", "sync", "install"]);
  });

  it("runs login without validation when config has no token", async () => {
    const validateAuth = vi.fn(async () => true);
    const login = vi.fn(async () => undefined);

    await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => ({ serverUrl: "https://token-burn.test" }),
      validateAuth,
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(validateAuth).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith({ serverUrl: "https://token-burn.test" });
  });

  it("runs login without validation when config server differs", async () => {
    const validateAuth = vi.fn(async () => true);
    const login = vi.fn(async () => undefined);

    await runSetup({
      serverUrl: "https://new-token-burn.test",
      readConfig: async () => authConfig({ serverUrl: "https://old-token-burn.test" }),
      validateAuth,
      login,
      sync: async () => undefined,
      installScheduler: async () => undefined,
      log: vi.fn(),
    });

    expect(validateAuth).not.toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith({ serverUrl: "https://new-token-burn.test" });
  });

  it("stops before sync and scheduler install when auth validation has a non-auth failure", async () => {
    const sync = vi.fn(async () => undefined);
    const installScheduler = vi.fn(async () => undefined);

    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => authConfig({ serverUrl: "https://token-burn.test" }),
        validateAuth: async () => {
          throw new Error("Server health check failed.");
        },
        login: async () => undefined,
        sync,
        installScheduler,
        log: vi.fn(),
      }),
    ).rejects.toThrow("Server health check failed.");

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

  it("attempts scheduler install when first sync fails after valid auth", async () => {
    const installScheduler = vi.fn(async () => undefined);
    const log = vi.fn();

    await runSetup({
      serverUrl: "https://token-burn.test",
      readConfig: async () => authConfig({ serverUrl: "https://token-burn.test" }),
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

  it("reports scheduler install failure clearly", async () => {
    await expect(
      runSetup({
        serverUrl: "https://token-burn.test",
        readConfig: async () => null,
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

function authConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    serverUrl: "https://token-burn.test",
    token: "tb_secret",
    ...overrides,
  };
}
```

- [ ] **Step 2: Run setup tests to verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/setup.test.ts
```

Expected: FAIL because `runSetup` does not accept `readConfig` or `validateAuth`, does not skip login, and still uses old scheduler wording.

- [ ] **Step 3: Implement auth validation in setup**

Replace `packages/cli/src/commands/setup.ts` with:

```ts
import { Command } from "commander";
import { z } from "zod";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { defaultServerUrl } from "../defaults.js";
import { getJson, HttpError } from "../http.js";
import { syncUsage } from "../sync.js";
import { runLogin } from "./login.js";
import { runInstallScheduler } from "./scheduler.js";

type SetupLogin = (options: { serverUrl: string }) => Promise<void>;
type SetupInstallScheduler = (options: { dryRun: boolean }) => Promise<void>;
type SetupValidateAuth = (options: { serverUrl: string; token: string }) => Promise<boolean>;

const authValidationResponseSchema = z.object({
  authenticated: z.literal(true),
  member: z.object({
    displayName: z.string().min(1),
    username: z.string().min(1).optional(),
  }),
});

export type SetupOptions = {
  serverUrl: string;
  readConfig?: () => Promise<CliConfig | null>;
  login?: SetupLogin;
  sync?: () => Promise<void>;
  installScheduler?: SetupInstallScheduler;
  validateAuth?: SetupValidateAuth;
  log?: (message: string) => void;
};

export async function runSetup({
  serverUrl,
  readConfig = readConfigFile,
  login = runLogin,
  sync = syncUsage,
  installScheduler = runInstallScheduler,
  validateAuth = validateAuthFromServer,
  log = console.log,
}: SetupOptions): Promise<void> {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  log("Starting Token Burn setup.");

  if (await canReuseExistingAuth({ serverUrl: normalizedServerUrl, readConfig, validateAuth })) {
    log("Existing authentication is valid.");
  } else {
    await login({ serverUrl: normalizedServerUrl });
    log("Login complete.");
  }

  let syncFailed = false;
  try {
    await sync();
    log("First sync complete.");
  } catch (error) {
    syncFailed = true;
    log(`First sync failed: ${formatErrorMessage(error)}`);
  }

  try {
    await installScheduler({ dryRun: false });
  } catch (error) {
    throw new Error(
      `Setup authenticated and attempted the first sync, but automatic sync was not installed: ${formatErrorMessage(
        error,
      )}. Retry with npx @blnayan/token-burn@latest install-scheduler.`,
    );
  }

  if (syncFailed) {
    log("Automatic sync was still installed or refreshed and will retry on quarter-hour boundaries.");
  }

  log("Setup complete. Automatic sync will run on quarter-hour boundaries.");
}

export function createSetupCommand(): Command {
  return new Command("setup")
    .description("Authenticate, sync once, and install automatic Token Burn sync")
    .option("-s, --server-url <url>", "Token Burn server URL")
    .option("--server <url>", "Alias for --server-url")
    .action(async (options: { serverUrl?: string; server?: string }) => {
      await runSetup({ serverUrl: options.serverUrl ?? options.server ?? defaultServerUrl() });
    });
}

async function canReuseExistingAuth({
  serverUrl,
  readConfig,
  validateAuth,
}: {
  serverUrl: string;
  readConfig: () => Promise<CliConfig | null>;
  validateAuth: SetupValidateAuth;
}): Promise<boolean> {
  const config = await readConfig();
  if (!config?.token) return false;
  if (normalizeServerUrl(config.serverUrl) !== serverUrl) return false;

  return validateAuth({ serverUrl, token: config.token });
}

async function validateAuthFromServer({ serverUrl, token }: { serverUrl: string; token: string }): Promise<boolean> {
  try {
    authValidationResponseSchema.parse(await getJson(`${serverUrl}/api/cli/auth`, token));
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return false;
    throw error;
  }
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Run setup tests to verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/setup.test.ts
```

Expected: PASS for all setup tests.

- [ ] **Step 5: Commit setup auth reuse**

```bash
git add packages/cli/src/commands/setup.ts packages/cli/src/commands/setup.test.ts
git commit -m "feat(cli): reuse valid auth during setup"
```

---

### Task 4: Reconcile Linux Cron Fallback After Systemd Success

**Files:**
- Modify: `packages/cli/src/scheduler.test.ts`
- Modify: `packages/cli/src/scheduler.ts`

- [ ] **Step 1: Add failing scheduler reconciliation tests**

In `packages/cli/src/scheduler.test.ts`, inside `describe("scheduler install runtime", ...)`, replace the current `it("installs a Linux systemd user timer when systemd is available", ...)` with:

```ts
it("installs a Linux systemd user timer and removes an existing cron fallback", async () => {
  const runtime = createMockSchedulerRuntime({
    platform: "linux",
    homeDir: "/home/me",
    commandOutput: new Map([
      [
        "crontab -l",
        [
          "MAILTO=me@example.com",
          "# BEGIN Token Burn scheduler",
          "*/15 * * * * 'token-burn' 'sync' >> /tmp/token-burn-sync.log 2>&1",
          "# END Token Burn scheduler",
          "0 0 * * * echo midnight",
          "",
        ].join("\n"),
      ],
    ]),
  });

  await installScheduler({ runtime, syncCommandArgv: ["/usr/bin/node", "/repo/dist/index.js", "sync"] });

  expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.service")).toContain(
    "ExecStart=/usr/bin/node /repo/dist/index.js sync",
  );
  expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).toContain("OnCalendar=*:0/15");
  expect(runtime.files.get("/home/me/.config/systemd/user/token-burn-sync.timer")).toContain("Persistent=true");
  expect(runtime.commands).toEqual([
    ["systemctl", ["--user", "daemon-reload"]],
    ["systemctl", ["--user", "enable", "--now", "token-burn-sync.timer"]],
    ["crontab", ["-l"]],
  ]);
  expect(runtime.stdinCommands).toEqual([
    {
      command: "crontab",
      args: ["-"],
      input: ["MAILTO=me@example.com", "0 0 * * * echo midnight", ""].join("\n"),
    },
  ]);
});
```

Add this test immediately after it:

```ts
it("does not rewrite crontab after systemd install when no cron fallback exists", async () => {
  const runtime = createMockSchedulerRuntime({
    platform: "linux",
    homeDir: "/home/me",
    commandOutput: new Map([["crontab -l", "0 0 * * * echo midnight\n"]]),
  });

  await installScheduler({ runtime, syncCommandArgv: ["/usr/bin/node", "/repo/dist/index.js", "sync"] });

  expect(runtime.commands).toEqual([
    ["systemctl", ["--user", "daemon-reload"]],
    ["systemctl", ["--user", "enable", "--now", "token-burn-sync.timer"]],
    ["crontab", ["-l"]],
  ]);
  expect(runtime.stdinCommands).toEqual([]);
});
```

- [ ] **Step 2: Run scheduler tests to verify failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "scheduler install runtime"
```

Expected: FAIL because systemd install does not read or clean crontab.

- [ ] **Step 3: Implement cron fallback cleanup**

In `packages/cli/src/scheduler.ts`, replace `installLinuxSystemdScheduler` with:

```ts
async function installLinuxSystemdScheduler(
  runtime: SchedulerRuntime,
  syncCommandArgv: SchedulerCommandArgv,
): Promise<void> {
  const dir = `${runtime.homeDir}/.config/systemd/user`;
  await runtime.mkdir(dir);
  await runtime.writeFile(`${dir}/token-burn-sync.service`, buildSystemdService(syncCommandArgv));
  await runtime.writeFile(`${dir}/token-burn-sync.timer`, buildSystemdTimer());
  await runtime.execFile("systemctl", ["--user", "daemon-reload"]);
  await runtime.execFile("systemctl", ["--user", "enable", "--now", "token-burn-sync.timer"]);
  await removeLinuxCronFallbackIfPresent(runtime);
}
```

Add this helper below `installLinuxCronScheduler`:

```ts
async function removeLinuxCronFallbackIfPresent(runtime: SchedulerRuntime): Promise<void> {
  const existing = await runtime.execFile("crontab", ["-l"]).catch(() => "");
  const cleaned = removeCronBlock(existing);

  if (cleaned === existing || cleaned === ensureTrailingNewline(existing)) return;

  await runtime.execFileWithInput("crontab", ["-"], cleaned);
}
```

- [ ] **Step 4: Run scheduler tests to verify pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "scheduler install runtime"
```

Expected: PASS for scheduler install runtime tests.

- [ ] **Step 5: Commit scheduler reconciliation**

```bash
git add packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "fix(cli): remove cron fallback after systemd install"
```

---

### Task 5: Full Verification

**Files:**
- Verify: `apps/web/src/app/api/cli/auth/route.ts`
- Verify: `apps/web/src/app/api/cli/auth/route.test.ts`
- Verify: `packages/cli/src/http.ts`
- Verify: `packages/cli/src/http.test.ts`
- Verify: `packages/cli/src/commands/setup.ts`
- Verify: `packages/cli/src/commands/setup.test.ts`
- Verify: `packages/cli/src/scheduler.ts`
- Verify: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Run focused CLI tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/http.test.ts src/commands/setup.test.ts src/scheduler.test.ts
```

Expected: PASS for HTTP, setup, and scheduler tests.

- [ ] **Step 2: Run focused web API tests**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/api/cli/auth/route.test.ts src/app/api/sync/route.test.ts src/app/api/cli/login/poll/route.test.ts
```

Expected: PASS for auth route plus nearby CLI-token route tests.

- [ ] **Step 3: Run typechecks**

Run:

```bash
pnpm --filter @blnayan/token-burn typecheck
pnpm --filter @token-burn/web typecheck
```

Expected: both typechecks pass.

- [ ] **Step 4: Inspect final behavior with test output**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/setup.test.ts -t "skips login|runs login|quarter-hour"
pnpm --filter @blnayan/token-burn test -- src/scheduler.test.ts -t "cron fallback"
```

Expected:

- Setup skips login only when same-server auth validates.
- Setup runs login when auth cannot be reused.
- Setup copy says quarter-hour boundaries.
- Linux systemd success removes a marked cron fallback.
- Linux cron fallback still replaces a marked cron block without duplication.

- [ ] **Step 5: Commit verification if any final adjustments were needed**

If the verification steps required code or test adjustments, commit them:

```bash
git add apps/web/src/app/api/cli/auth/route.ts apps/web/src/app/api/cli/auth/route.test.ts packages/cli/src/http.ts packages/cli/src/http.test.ts packages/cli/src/commands/setup.ts packages/cli/src/commands/setup.test.ts packages/cli/src/scheduler.ts packages/cli/src/scheduler.test.ts
git commit -m "test: verify idempotent setup reruns"
```

If no files changed during verification, do not create an empty commit.
