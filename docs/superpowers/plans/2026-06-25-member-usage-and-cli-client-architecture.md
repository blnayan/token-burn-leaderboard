# Member Usage And CLI Client Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the member usage detail and CLI server communication seams without changing public API responses, CLI command behavior, UI behavior, or database schema.

**Architecture:** Add a transport-independent member usage query module and move member usage detail behavior behind it. Add a typed Token Burn server client facade for CLI endpoint calls, backed by the existing fetch behavior and narrow method-level fakes in command tests.

**Tech Stack:** TypeScript, Next.js route handlers, Prisma, Zod, Commander, Vitest, pnpm workspaces.

---

## File Structure

### Web Member Usage

- Create: `apps/web/src/server/member-usage-query.ts`
  - Owns parsing `URLSearchParams` into a normalized query object.
  - Owns validation errors for invalid range, provider, model, device, and provider/model combination.
  - Exports `parseMemberUsageQuery`, `MemberUsageQueryError`, and query/filter types.
- Create: `apps/web/src/server/member-usage-query.test.ts`
  - Tests URL query parsing and validation behavior directly.
- Modify: `apps/web/src/server/leaderboard.ts`
  - Keep `getLeaderboard`, `rankRows`, and shared helpers.
  - Change member usage detail entry point to accept the normalized query object.
  - Preserve current member usage response shape and cost/trend behavior.
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.ts`
  - Delegate semantic search-param parsing to `member-usage-query.ts`.
  - Translate `MemberUsageQueryError` into the same HTTP 400 responses.
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`
  - Stop asserting old internal filter object choreography.
  - Verify HTTP status and schema behavior.
- Modify: `apps/web/src/server/leaderboard.test.ts`
  - Update calls to the normalized member usage query object.

### CLI Server Client

- Create: `packages/cli/src/server-client.ts`
  - Owns URL normalization, endpoint paths, bearer auth, JSON parsing, `HttpError`, and endpoint-specific schemas.
  - Exports `createTokenBurnServerClient`, `TokenBurnServerClient`, `HttpError`, and endpoint response types needed by commands.
- Create: `packages/cli/src/server-client.test.ts`
  - Tests URL normalization, headers, endpoint paths, malformed JSON, HTTP error messages, and endpoint schema parsing.
- Modify: `packages/cli/src/http.ts`
  - Re-export `HttpError`, `getJson`, and `postJson` from `server-client.ts`, or become a small compatibility shim.
- Modify: `packages/cli/src/sync.ts`
  - Depend on `TokenBurnServerClient` instead of raw `getJson`, `postJson`, and local health parsing.
- Modify: `packages/cli/src/commands/setup.ts`
  - Use the typed server client for auth validation.
- Modify: `packages/cli/src/commands/login.ts`
  - Use the typed server client for login start/poll.
- Modify: `packages/cli/src/commands/status.ts`
  - Use the typed server client for health.
- Modify: `packages/cli/src/commands/doctor.ts`
  - Use the typed server client for health and devices.
- Modify: `packages/cli/src/commands/devices.ts`
  - Use the typed server client for device list and merge.
- Modify tests in `packages/cli/src/*.test.ts` and `packages/cli/src/commands/*.test.ts`
  - Fake the server client at the method level where testing command behavior.
  - Keep user-visible output assertions intact.

---

## Task 1: Add Member Usage Query Parser

**Files:**
- Create: `apps/web/src/server/member-usage-query.ts`
- Create: `apps/web/src/server/member-usage-query.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `apps/web/src/server/member-usage-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  MemberUsageQueryError,
  parseMemberUsageQuery,
} from "./member-usage-query";

describe("parseMemberUsageQuery", () => {
  it("defaults to daily period with empty filters", () => {
    expect(parseMemberUsageQuery(new URLSearchParams())).toEqual({
      period: "daily",
      filters: {
        providers: [],
        models: [],
        devices: [],
      },
    });
  });

  it("parses range, provider, model, and device params", () => {
    const providerQuery = parseMemberUsageQuery(
      new URLSearchParams([
        ["range", "7d"],
        ["provider", "codex"],
        ["device", "device-1"],
        ["device", "device-2"],
      ]),
    );

    expect(providerQuery).toEqual({
      period: "7d",
      filters: {
        providers: ["codex"],
        models: [],
        devices: ["device-1", "device-2"],
      },
    });

    const modelQuery = parseMemberUsageQuery(
      new URLSearchParams([
        ["range", "30d"],
        ["model", "codex:gpt-5.4"],
      ]),
    );

    expect(modelQuery).toEqual({
      period: "30d",
      filters: {
        providers: [],
        models: [{ provider: "codex", modelName: "gpt-5.4" }],
        devices: [],
      },
    });
  });

  it("splits model filters on the first colon only", () => {
    expect(parseMemberUsageQuery(new URLSearchParams([["model", "codex:model:with:colon"]]))).toEqual({
      period: "daily",
      filters: {
        providers: [],
        models: [{ provider: "codex", modelName: "model:with:colon" }],
        devices: [],
      },
    });
  });

  it("rejects invalid inputs with stable response messages", () => {
    expect(() => parseMemberUsageQuery(new URLSearchParams([["range", "bad"]]))).toThrow(
      new MemberUsageQueryError("Invalid usage range"),
    );
    expect(() => parseMemberUsageQuery(new URLSearchParams([["provider", "bad"]]))).toThrow(
      new MemberUsageQueryError("Invalid provider filter"),
    );
    expect(() => parseMemberUsageQuery(new URLSearchParams([["model", "codex"]]))).toThrow(
      new MemberUsageQueryError("Invalid model filter"),
    );
    expect(() => parseMemberUsageQuery(new URLSearchParams([["device", "  "]]))).toThrow(
      new MemberUsageQueryError("Invalid device filter"),
    );
    expect(() =>
      parseMemberUsageQuery(
        new URLSearchParams([
          ["provider", "codex"],
          ["model", "codex:gpt-5.4"],
        ]),
      ),
    ).toThrow(new MemberUsageQueryError("Provider and model filters cannot be combined"));
  });
});
```

- [ ] **Step 2: Run parser test to verify it fails**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/member-usage-query.test.ts
```

Expected: FAIL because `apps/web/src/server/member-usage-query.ts` does not exist.

- [ ] **Step 3: Implement parser module**

Create `apps/web/src/server/member-usage-query.ts`:

```ts
import {
  memberUsageRangeSchema,
  periodSchema,
  providerSchema,
  type LeaderboardPeriod,
  type MemberUsageDetail,
  type MemberUsageRange,
} from "@token-burn/shared";

export type MemberUsageRequestPeriod = LeaderboardPeriod | MemberUsageRange;

export type MemberUsageModelFilter = {
  provider: MemberUsageDetail["models"][number]["provider"];
  modelName: string;
};

export type MemberUsageFilters = {
  providers: MemberUsageDetail["providers"][number]["provider"][];
  models: MemberUsageModelFilter[];
  devices: string[];
};

export type MemberUsageQuery = {
  period: MemberUsageRequestPeriod;
  filters: MemberUsageFilters;
};

export class MemberUsageQueryError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "MemberUsageQueryError";
  }
}

export const emptyMemberUsageFilters: MemberUsageFilters = {
  providers: [],
  models: [],
  devices: [],
};

export function parseMemberUsageQuery(searchParams: URLSearchParams): MemberUsageQuery {
  const rangeParam = searchParams.get("range");
  const parsedRange = rangeParam ? memberUsageRangeSchema.safeParse(rangeParam) : null;

  if (parsedRange && !parsedRange.success) {
    throw new MemberUsageQueryError("Invalid usage range");
  }

  const providerFilters: MemberUsageFilters["providers"] = [];
  for (const providerParam of searchParams.getAll("provider")) {
    const parsedProvider = providerSchema.safeParse(providerParam.trim());
    if (!parsedProvider.success) {
      throw new MemberUsageQueryError("Invalid provider filter");
    }
    providerFilters.push(parsedProvider.data);
  }

  const modelFilters: MemberUsageFilters["models"] = [];
  for (const modelParam of searchParams.getAll("model")) {
    const separatorIndex = modelParam.indexOf(":");
    if (separatorIndex <= 0) {
      throw new MemberUsageQueryError("Invalid model filter");
    }

    const providerPart = modelParam.slice(0, separatorIndex).trim();
    const modelName = modelParam.slice(separatorIndex + 1).trim();
    const parsedProvider = providerSchema.safeParse(providerPart);
    if (!parsedProvider.success || modelName.length === 0) {
      throw new MemberUsageQueryError("Invalid model filter");
    }

    modelFilters.push({ provider: parsedProvider.data, modelName });
  }

  if (providerFilters.length > 0 && modelFilters.length > 0) {
    throw new MemberUsageQueryError("Provider and model filters cannot be combined");
  }

  const deviceFilters: MemberUsageFilters["devices"] = [];
  for (const deviceParam of searchParams.getAll("device")) {
    const device = deviceParam.trim();
    if (device.length === 0) {
      throw new MemberUsageQueryError("Invalid device filter");
    }
    deviceFilters.push(device);
  }

  const period =
    parsedRange?.data ??
    periodSchema.catch("daily").parse(searchParams.get("period") ?? undefined);

  return {
    period,
    filters: {
      providers: providerFilters,
      models: modelFilters,
      devices: deviceFilters,
    },
  };
}
```

- [ ] **Step 4: Run parser test to verify it passes**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/member-usage-query.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit parser seam**

Run:

```bash
git add apps/web/src/server/member-usage-query.ts apps/web/src/server/member-usage-query.test.ts
git commit -m "refactor: add member usage query parser"
```

---

## Task 2: Route Member Usage Through Query Seam

**Files:**
- Modify: `apps/web/src/server/leaderboard.ts`
- Modify: `apps/web/src/server/leaderboard.test.ts`
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.ts`
- Modify: `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`

- [ ] **Step 1: Update failing route test expectations**

In `apps/web/src/app/api/leaderboard/members/[username]/route.test.ts`, replace assertions that inspect separate period and filters arguments with assertions against the normalized query object. For the weekly period test, use this assertion shape:

```ts
expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
  "ada",
  {
    period: "weekly",
    filters: {
      providers: [],
      models: [],
      devices: [],
    },
  },
  expect.any(Date),
);
```

For the range and filter tests, use this assertion shape:

```ts
expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
  "ada",
  {
    period: "7d",
    filters: {
      providers: ["codex"],
      models: [],
      devices: ["device-1"],
    },
  },
  expect.any(Date),
);
```

Keep existing HTTP 400 and 404 assertions unchanged.

- [ ] **Step 2: Update failing leaderboard tests**

In `apps/web/src/server/leaderboard.test.ts`, update calls from:

```ts
await getMemberUsageDetail("ada", "7d", now, {
  providers: ["codex"],
  models: [],
  devices: ["device-1"],
});
```

to:

```ts
await getMemberUsageDetail(
  "ada",
  {
    period: "7d",
    filters: {
      providers: ["codex"],
      models: [],
      devices: ["device-1"],
    },
  },
  now,
);
```

For unfiltered calls, pass:

```ts
{
  period: "7d",
  filters: {
    providers: [],
    models: [],
    devices: [],
  },
}
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/leaderboard.test.ts src/app/api/leaderboard/members/[username]/route.test.ts
```

Expected: FAIL because `getMemberUsageDetail` and the route still use the old interface.

- [ ] **Step 4: Update `leaderboard.ts` member usage interface**

In `apps/web/src/server/leaderboard.ts`, import the query type and remove the local duplicate filter/request-period types:

```ts
import {
  emptyMemberUsageFilters,
  type MemberUsageFilters,
  type MemberUsageQuery,
  type MemberUsageRequestPeriod,
} from "./member-usage-query";
```

Change the function signature from:

```ts
export async function getMemberUsageDetail(
  username: string,
  period: MemberUsageRequestPeriod,
  now = new Date(),
  filters: MemberUsageFilters = emptyMemberUsageFilters,
): Promise<MemberUsageDetail | null> {
```

to:

```ts
export async function getMemberUsageDetail(
  username: string,
  query: MemberUsageQuery,
  now = new Date(),
): Promise<MemberUsageDetail | null> {
  const { period, filters = emptyMemberUsageFilters } = query;
```

Keep the existing implementation body after the new `const { period, filters... }` line.

- [ ] **Step 5: Update route to delegate query parsing**

In `apps/web/src/app/api/leaderboard/members/[username]/route.ts`, replace the manual parsing logic with:

```ts
import { memberUsageDetailSchema } from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getMemberUsageDetail } from "@/server/leaderboard";
import { MemberUsageQueryError, parseMemberUsageQuery } from "@/server/member-usage-query";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  let query;
  try {
    query = parseMemberUsageQuery(request.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof MemberUsageQueryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const detail = await getMemberUsageDetail(username, query, new Date());

  if (!detail) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  return NextResponse.json(memberUsageDetailSchema.parse(detail));
}
```

- [ ] **Step 6: Run focused tests to verify they pass**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/member-usage-query.test.ts src/server/leaderboard.test.ts src/app/api/leaderboard/members/[username]/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit member usage query adoption**

Run:

```bash
git add apps/web/src/server/member-usage-query.ts apps/web/src/server/member-usage-query.test.ts apps/web/src/server/leaderboard.ts apps/web/src/server/leaderboard.test.ts apps/web/src/app/api/leaderboard/members/[username]/route.ts apps/web/src/app/api/leaderboard/members/[username]/route.test.ts
git commit -m "refactor: route member usage through query seam"
```

---

## Task 3: Add Typed CLI Server Client

**Files:**
- Create: `packages/cli/src/server-client.ts`
- Create: `packages/cli/src/server-client.test.ts`
- Modify: `packages/cli/src/http.ts`

- [ ] **Step 1: Write failing server client tests**

Create `packages/cli/src/server-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { HttpError, createTokenBurnServerClient, getJson, postJson } from "./server-client.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("TokenBurnServerClient", () => {
  it("normalizes base URLs and reads health", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ requiredCliVersion: "0.1.0", serverTime: "2026-06-25T00:00:00.000Z" }),
    );
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test///", fetch: fetchMock });

    await expect(client.readHealth()).resolves.toEqual({
      requiredCliVersion: "0.1.0",
      serverTime: "2026-06-25T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/health", {
      method: "GET",
      headers: {},
    });
  });

  it("sends bearer auth for protected endpoints", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        serverTime: "2026-06-25T00:00:00.000Z",
        until: "2026-06-25",
        providers: [{ provider: "codex", since: "2026-06-24" }],
      }),
    );
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await client.readSyncWindows({ token: "secret", deviceId: "device-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://token-burn.test/api/cli/sync-windows?deviceId=device-1",
      {
        method: "GET",
        headers: { authorization: "Bearer secret" },
      },
    );
  });

  it("preserves server error messages", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "Unauthorized" }, { status: 401 }));
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await expect(client.validateAuth({ token: "bad" })).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
      message: "Unauthorized",
    });
  });

  it("rejects malformed JSON and malformed endpoint responses", async () => {
    const badJsonFetch = vi.fn(async () => new Response("not-json", { status: 200 }));
    await expect(getJson("https://token-burn.test/api", undefined, badJsonFetch)).rejects.toThrow(
      "Expected JSON response.",
    );

    const badShapeFetch = vi.fn(async () => jsonResponse({ requiredCliVersion: 1, serverTime: null }));
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: badShapeFetch });
    await expect(client.readHealth()).rejects.toThrow();
  });

  it("posts JSON bodies", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true }));

    await expect(postJson("https://token-burn.test/api/sync", { ok: true }, "token", fetchMock)).resolves.toEqual({
      accepted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ ok: true }),
    });
  });
});
```

- [ ] **Step 2: Run server client test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/server-client.test.ts
```

Expected: FAIL because `server-client.ts` does not exist.

- [ ] **Step 3: Implement server client**

Create `packages/cli/src/server-client.ts`:

```ts
import { z } from "zod";

import {
  syncWindowsResponseSchema,
  type SyncPayload,
  type SyncWindowsResponse,
} from "@token-burn/shared";

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type CliHealth = {
  requiredCliVersion: string;
  serverTime: string;
};

export type AuthValidationResponse = {
  authenticated: true;
  member: {
    displayName: string;
    username?: string;
  };
};

export type LoginStartResponse = {
  loginUrl: string;
  pollToken: string;
  expiresAt: string;
};

export type LoginPollResponse =
  | { status: "pending" }
  | {
      status: "approved";
      token: string;
      member: {
        displayName: string;
        username?: string;
      };
    };

export type DeviceSummary = {
  id: string;
  name: string;
  os: string;
  firstSeenAt: string;
  lastSeenAt: string;
  dailyRows: number;
  totalTokens: string;
};

export type DuplicateDeviceGroup = {
  name: string;
  os: string;
  duplicateRows: number;
  conflictRows: number;
  devices: DeviceSummary[];
};

export type DeviceListResponse = {
  devices: DeviceSummary[];
  duplicateGroups: DuplicateDeviceGroup[];
};

export type DeviceMergeResponse = {
  sourceDeviceId: string;
  targetDeviceId: string;
  deletedDuplicateRows: number;
  movedRows: number;
  resolvedConflictRows: number;
  deletedSourceDevice: boolean;
};

export type TokenBurnServerClient = {
  readHealth(): Promise<CliHealth>;
  validateAuth(options: { token: string }): Promise<AuthValidationResponse>;
  readSyncWindows(options: { token: string; deviceId: string }): Promise<SyncWindowsResponse>;
  submitSyncPayload(options: { token: string; payload: SyncPayload }): Promise<{ accepted: true }>;
  startLogin(): Promise<LoginStartResponse>;
  pollLogin(options: { pollToken: string }): Promise<LoginPollResponse>;
  listDevices(options: { token: string }): Promise<DeviceListResponse>;
  mergeDevices(options: { token: string; sourceDeviceId: string; targetDeviceId: string }): Promise<DeviceMergeResponse>;
};

type FetchLike = typeof fetch;

const cliHealthSchema = z.object({
  requiredCliVersion: z.string(),
  serverTime: z.string(),
});

const authValidationResponseSchema = z.object({
  authenticated: z.literal(true),
  member: z.object({
    displayName: z.string().min(1),
    username: z.string().min(1).optional(),
  }),
});

const loginStartResponseSchema = z.object({
  loginUrl: z.string().url(),
  pollToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

const loginPollResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("approved"),
    token: z.string().min(1),
    member: z.object({
      displayName: z.string().min(1),
      username: z.string().min(1).optional(),
    }),
  }),
]);

const deviceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  os: z.string().min(1),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  dailyRows: z.number().int().nonnegative(),
  totalTokens: z.string().regex(/^\d+$/),
});

const duplicateGroupSchema = z.object({
  name: z.string().min(1),
  os: z.string().min(1),
  duplicateRows: z.number().int().nonnegative(),
  conflictRows: z.number().int().nonnegative(),
  devices: z.array(deviceSummarySchema),
});

const deviceListResponseSchema = z.object({
  devices: z.array(deviceSummarySchema),
  duplicateGroups: z.array(duplicateGroupSchema),
});

const deviceMergeResponseSchema = z.object({
  sourceDeviceId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  deletedDuplicateRows: z.number().int().nonnegative(),
  movedRows: z.number().int().nonnegative(),
  resolvedConflictRows: z.number().int().nonnegative(),
  deletedSourceDevice: z.boolean(),
});

const syncAcceptedSchema = z.object({
  accepted: z.literal(true),
});

export function createTokenBurnServerClient({
  serverUrl,
  fetch: fetchImpl = fetch,
}: {
  serverUrl: string;
  fetch?: FetchLike;
}): TokenBurnServerClient {
  const baseUrl = normalizeServerUrl(serverUrl);

  return {
    async readHealth() {
      return cliHealthSchema.parse(await getJson(`${baseUrl}/api/cli/health`, undefined, fetchImpl));
    },
    async validateAuth({ token }) {
      return authValidationResponseSchema.parse(await getJson(`${baseUrl}/api/cli/auth`, token, fetchImpl));
    },
    async readSyncWindows({ token, deviceId }) {
      const url = `${baseUrl}/api/cli/sync-windows?deviceId=${encodeURIComponent(deviceId)}`;
      return syncWindowsResponseSchema.parse(await getJson(url, token, fetchImpl));
    },
    async submitSyncPayload({ token, payload }) {
      return syncAcceptedSchema.parse(await postJson(`${baseUrl}/api/sync`, payload, token, fetchImpl));
    },
    async startLogin() {
      return loginStartResponseSchema.parse(await postJson(`${baseUrl}/api/cli/login/start`, {}, undefined, fetchImpl));
    },
    async pollLogin({ pollToken }) {
      return loginPollResponseSchema.parse(await postJson(`${baseUrl}/api/cli/login/poll`, { pollToken }, undefined, fetchImpl));
    },
    async listDevices({ token }) {
      return deviceListResponseSchema.parse(await getJson(`${baseUrl}/api/cli/devices`, token, fetchImpl));
    },
    async mergeDevices({ token, sourceDeviceId, targetDeviceId }) {
      return deviceMergeResponseSchema.parse(
        await postJson(`${baseUrl}/api/cli/devices/merge`, { sourceDeviceId, targetDeviceId }, token, fetchImpl),
      );
    },
  };
}

export async function getJson<T>(url: string, token?: string, fetchImpl: FetchLike = fetch): Promise<T> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  return parseJsonResponse<T>(response);
}

export async function postJson<T>(url: string, body: unknown, token?: string, fetchImpl: FetchLike = fetch): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
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

- [ ] **Step 4: Make `http.ts` a compatibility shim**

Replace `packages/cli/src/http.ts` with:

```ts
export { HttpError, getJson, postJson } from "./server-client.js";
```

- [ ] **Step 5: Run server client tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/server-client.test.ts src/http.test.ts
```

Expected: PASS. If `src/http.test.ts` expects implementation-local details, update it to assert the same public `getJson`, `postJson`, and `HttpError` behavior through the shim.

- [ ] **Step 6: Commit server client**

Run:

```bash
git add packages/cli/src/server-client.ts packages/cli/src/server-client.test.ts packages/cli/src/http.ts packages/cli/src/http.test.ts
git commit -m "refactor: add typed token burn server client"
```

---

## Task 4: Adopt Server Client In Sync, Setup, And Login

**Files:**
- Modify: `packages/cli/src/sync.ts`
- Modify: `packages/cli/src/sync.test.ts`
- Modify: `packages/cli/src/commands/setup.ts`
- Modify: `packages/cli/src/commands/setup.test.ts`
- Modify: `packages/cli/src/commands/login.ts`
- Modify: `packages/cli/src/commands/login.test.ts`

- [ ] **Step 1: Update sync dependency tests to use method-level fake**

In `packages/cli/src/sync.test.ts`, replace `getJson` and `postJson` dependency setup in sync-window tests with a `serverClient` fake:

```ts
const submittedPayloads: unknown[] = [];

await syncUsage({
  readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
  writeConfig: async () => undefined,
  serverClient: {
    readHealth: async () => ({
      requiredCliVersion: "0.1.0",
      serverTime: "2026-06-25T00:00:00.000Z",
    }),
    readSyncWindows: async () => ({
      serverTime: "2026-06-25T00:00:00.000Z",
      until: "2026-06-25",
      providers: [{ provider: "codex", since: "2026-06-24" }],
    }),
    submitSyncPayload: async ({ payload }) => {
      submittedPayloads.push(payload);
      return { accepted: true };
    },
  },
  readProviderUsage: async (provider) => [
    { provider, date: "2026-06-25", tokenCategories: { input: 10 }, totalTokens: 10 },
  ],
  readCcusageVersion: async () => "1.0.0",
  cliVersion: "0.1.0",
  createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
  readDeviceName: () => "Test Device",
});

expect(submittedPayloads).toHaveLength(2);
```

Keep existing assertions for provider windows, skipped providers, failed providers, and `lastSync` messages.

- [ ] **Step 2: Run sync tests to verify they fail**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts
```

Expected: FAIL because `syncUsage` does not accept `serverClient`.

- [ ] **Step 3: Update `sync.ts` to accept server client facade**

In `packages/cli/src/sync.ts`, import the client:

```ts
import {
  createTokenBurnServerClient,
  type CliHealth,
  type TokenBurnServerClient,
} from "./server-client.js";
```

Change `SyncDependencies` by replacing raw HTTP dependencies:

```ts
serverClient?: Pick<TokenBurnServerClient, "readHealth" | "readSyncWindows" | "submitSyncPayload">;
```

In `syncUsage`, after config auth validation:

```ts
const client =
  serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
```

Replace:

```ts
const health = await readHealth(config.serverUrl);
```

with:

```ts
const health = await client.readHealth();
```

Replace `readSyncWindows({ getJson, serverUrl: config.serverUrl, token: config.token, deviceId })` with:

```ts
syncWindows = await client.readSyncWindows({ token: config.token, deviceId });
```

Replace:

```ts
await postJson(syncUrl, payload, config.token);
```

with:

```ts
await client.submitSyncPayload({ token: config.token, payload });
```

Delete the local `readSyncWindows`, `readHealthFromServer`, `parseJsonOrNull`, `formatHttpError`, and `isRecord` helpers when no longer used.

- [ ] **Step 4: Update setup and login to use server client**

In `packages/cli/src/commands/setup.ts`, replace the local `validateAuthFromServer` implementation with a server client call:

```ts
import { HttpError, createTokenBurnServerClient } from "../server-client.js";
```

```ts
async function validateAuthFromServer({
  serverUrl,
  token,
}: {
  serverUrl: string;
  token: string;
}): Promise<boolean> {
  try {
    await createTokenBurnServerClient({ serverUrl }).validateAuth({ token });
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return false;
    throw error;
  }
}
```

Remove the local Zod `authValidationResponseSchema` and `getJson` import if unused.

In `packages/cli/src/commands/login.ts`, add an optional dependency:

```ts
import { createTokenBurnServerClient, type TokenBurnServerClient } from "../server-client.js";
```

```ts
serverClient?: Pick<TokenBurnServerClient, "startLogin" | "pollLogin">;
```

Inside `runLogin`, create:

```ts
const client = serverClient ?? createTokenBurnServerClient({ serverUrl: normalizedServerUrl });
const startResponse = await client.startLogin();
```

Replace poll request with:

```ts
const pollResponse = await client.pollLogin({ pollToken: startResponse.pollToken });
```

Remove local login response schemas and `postJson` import if unused.

- [ ] **Step 5: Update setup and login tests**

In `packages/cli/src/commands/login.test.ts`, replace raw `postJson` fakes with:

```ts
serverClient: {
  startLogin: async () => ({
    loginUrl: "https://token-burn.test/cli/approve/code",
    pollToken: "poll-token",
    expiresAt: "2026-06-25T00:10:00.000Z",
  }),
  pollLogin: async () => ({
    status: "approved",
    token: "cli-token",
    member: { displayName: "Ada", username: "ada" },
  }),
},
```

In `packages/cli/src/commands/setup.test.ts`, keep `validateAuth` dependency tests as-is unless they assert `getJson` details. The default implementation is covered through `server-client.test.ts`.

- [ ] **Step 6: Run focused CLI tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts src/commands/setup.test.ts src/commands/login.test.ts src/server-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit sync/setup/login adoption**

Run:

```bash
git add packages/cli/src/sync.ts packages/cli/src/sync.test.ts packages/cli/src/commands/setup.ts packages/cli/src/commands/setup.test.ts packages/cli/src/commands/login.ts packages/cli/src/commands/login.test.ts
git commit -m "refactor: use server client for sync and auth flows"
```

---

## Task 5: Adopt Server Client In Status, Doctor, And Devices

**Files:**
- Modify: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/commands/status.test.ts`
- Modify: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/commands/doctor.test.ts`
- Modify: `packages/cli/src/commands/devices.ts`
- Modify: `packages/cli/src/commands/devices.test.ts`

- [ ] **Step 1: Update status to use server client**

In `packages/cli/src/commands/status.ts`, import:

```ts
import { createTokenBurnServerClient, type CliHealth, type TokenBurnServerClient } from "../server-client.js";
```

Change `StatusDependencies`:

```ts
serverClient?: Pick<TokenBurnServerClient, "readHealth">;
```

Inside authenticated branch:

```ts
const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
```

Replace:

```ts
const health = await readHealth(config.serverUrl);
```

with:

```ts
const health = await client.readHealth();
```

Delete local `readHealthFromServer`, `formatRequiredCliVersionError` only if replaced by an existing shared helper, and `isRecord` when unused. Keep `formatRequiredCliVersionError` if it remains local command output behavior.

- [ ] **Step 2: Update doctor to use server client**

In `packages/cli/src/commands/doctor.ts`, import:

```ts
import { createTokenBurnServerClient, type CliHealth, type DeviceListResponse, type TokenBurnServerClient } from "../server-client.js";
```

Change `DoctorDependencies`:

```ts
serverClient?: Pick<TokenBurnServerClient, "readHealth" | "listDevices">;
```

Inside authenticated branch:

```ts
const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
```

Replace:

```ts
await readHealth(config.serverUrl);
const devices = await readDevices(config.serverUrl, config.token);
```

with:

```ts
await client.readHealth();
const devices = await client.listDevices({ token: config.token });
```

Delete local `readHealthFromServer`, `readDevicesFromServer`, `getJson`, `parseJsonOrNull`, `normalizeServerUrl`, and `isRecord` helpers when unused.

- [ ] **Step 3: Update devices to use server client**

In `packages/cli/src/commands/devices.ts`, import:

```ts
import { createTokenBurnServerClient, type TokenBurnServerClient } from "../server-client.js";
```

Change `DevicesDependencies`:

```ts
serverClient?: Pick<TokenBurnServerClient, "listDevices" | "mergeDevices">;
```

In `runListDevices`:

```ts
const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
const response = await client.listDevices({ token: config.token });
```

In `runMergeDevices`:

```ts
const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
const response = await client.mergeDevices({ token: config.token, sourceDeviceId, targetDeviceId });
```

Delete local device response schemas, `getJsonRequest`, `parseJsonOrNull`, and `normalizeServerUrl` when unused. Keep result type exports by importing and re-exporting server client types:

```ts
export type { DeviceListResponse as DeviceListResult, DeviceMergeResponse as DeviceMergeResult } from "../server-client.js";
```

- [ ] **Step 4: Update command tests to use method-level fakes**

In `status.test.ts`, pass:

```ts
serverClient: {
  readHealth: async () => ({
    requiredCliVersion: cliVersion,
    serverTime: "2026-06-25T00:00:00.000Z",
  }),
},
```

In `doctor.test.ts`, pass:

```ts
serverClient: {
  readHealth: async () => ({
    requiredCliVersion: cliVersion,
    serverTime: "2026-06-25T00:00:00.000Z",
  }),
  listDevices: async () => ({
    devices: [],
    duplicateGroups: [],
  }),
},
```

In `devices.test.ts`, pass:

```ts
serverClient: {
  listDevices: async () => response,
  mergeDevices: async () => mergeResponse,
},
```

Keep output assertions unchanged.

- [ ] **Step 5: Run focused command tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/status.test.ts src/commands/doctor.test.ts src/commands/devices.test.ts src/server-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit command adoption**

Run:

```bash
git add packages/cli/src/commands/status.ts packages/cli/src/commands/status.test.ts packages/cli/src/commands/doctor.ts packages/cli/src/commands/doctor.test.ts packages/cli/src/commands/devices.ts packages/cli/src/commands/devices.test.ts
git commit -m "refactor: use server client in cli status and devices"
```

---

## Task 6: Cleanup, Typecheck, And Full Verification

**Files:**
- Modify only files touched by earlier tasks if cleanup is required.

- [ ] **Step 1: Search for duplicate HTTP and member usage parsing remnants**

Run:

```bash
rg -n "parseJsonOrNull|formatHttpError|normalizeServerUrl|readHealthFromServer|readBearerToken|providerFilters|modelFilters" packages/cli/src apps/web/src/app/api/leaderboard/members apps/web/src/server
```

Expected:

- `packages/cli/src/server-client.ts` may contain `parseJsonOrNull`, `formatHttpError`, and URL normalization.
- No CLI command module should contain local JSON parsing helpers.
- Member usage route should not contain provider/model/device filter parsing.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @token-burn/web test -- src/server/member-usage-query.test.ts src/server/leaderboard.test.ts src/app/api/leaderboard/members/[username]/route.test.ts
pnpm --filter @blnayan/token-burn test -- src/server-client.test.ts src/sync.test.ts src/commands/setup.test.ts src/commands/login.test.ts src/commands/status.test.ts src/commands/doctor.test.ts src/commands/devices.test.ts src/http.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks**

Run:

```bash
pnpm --filter @token-burn/web typecheck
pnpm --filter @blnayan/token-burn typecheck
```

Expected: PASS.

- [ ] **Step 4: Run broader test suite if focused checks pass**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit cleanup**

If Step 1 required cleanup changes, run:

```bash
git add apps/web/src packages/cli/src
git commit -m "refactor: clean up architecture seam remnants"
```

If no cleanup changes were required, skip this commit.

---

## Spec Coverage Self-Check

- Member usage query seam: Tasks 1 and 2.
- Member usage validation and compatibility: Tasks 1 and 2.
- CLI typed server client: Task 3.
- Sync, setup, login client adoption: Task 4.
- Status, doctor, devices client adoption: Task 5.
- Error behavior and public compatibility: Tasks 3 through 6.
- Focused and broad verification: Task 6.
