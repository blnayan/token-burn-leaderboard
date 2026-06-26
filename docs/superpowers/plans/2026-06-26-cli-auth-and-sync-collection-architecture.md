# CLI Auth And Sync Collection Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen CLI-authenticated web routes behind one auth gate module and deepen CLI sync provider collection behind one sync collection module.

**Architecture:** `apps/web/src/server/cli-auth.ts` becomes the route-facing CLI auth gate, hiding bearer parsing, token lookup, and unauthorized response construction. `packages/cli/src/sync-collection.ts` becomes the provider collection pipeline, hiding ccusage version lookup, provider window mapping, payload shaping, provider error normalization, and submission counting from `syncUsage`.

**Tech Stack:** TypeScript, Next.js route handlers, Prisma client adapters, Vitest, Zod shared schemas, ccusage CLI adapter, pnpm workspace.

---

## File Structure

- Modify: `apps/web/src/server/cli-auth.ts`
  - Keep existing token/code helpers.
  - Add `authenticateCliRequest`, `unauthorizedCliResponse`, and supporting types.
  - Keep Prisma lookup local and injectable for tests.
- Modify: `apps/web/src/server/cli-auth.test.ts`
  - Add auth-gate tests for bearer parsing, unauthorized cases, selected context, and response shape.
- Modify: `apps/web/src/app/api/cli/auth/route.ts`
  - Replace repeated auth implementation with `authenticateCliRequest`.
- Modify: `apps/web/src/app/api/cli/auth/route.test.ts`
  - Assert route behavior through the auth gate shape rather than duplicating hash/Prisma choreography.
- Modify: `apps/web/src/app/api/cli/sync-windows/route.ts`
  - Replace repeated auth implementation with `authenticateCliRequest`.
- Modify: `apps/web/src/app/api/cli/sync-windows/route.test.ts`
  - Keep route-specific sync-window behavior and `401` behavior.
- Modify: `apps/web/src/app/api/sync/route.ts`
  - Replace valid-token lookup with `authenticateCliRequest`.
  - Preserve route-owned rate limits, payload parsing, version enforcement, and sync ingest.
- Modify: `apps/web/src/app/api/sync/route.test.ts`
  - Cover missing/invalid auth, required CLI version, and authenticated persistence.
- Modify: `apps/web/src/app/api/cli/devices/route.ts`
  - Replace repeated auth implementation with `authenticateCliRequest`.
- Create: `apps/web/src/app/api/cli/devices/route.test.ts`
  - Cover `401` and authenticated list response.
- Modify: `apps/web/src/app/api/cli/devices/merge/route.ts`
  - Replace repeated auth implementation with `authenticateCliRequest`.
- Create: `apps/web/src/app/api/cli/devices/merge/route.test.ts`
  - Cover `401`, invalid payload, device merge domain error, and authenticated merge response.
- Create: `packages/cli/src/sync-collection.ts`
  - Own provider collection pipeline and return structured collection result.
- Create: `packages/cli/src/sync-collection.test.ts`
  - Cover provider windows, payload shaping, submission counts, and provider issue classification.
- Modify: `packages/cli/src/sync.ts`
  - Delegate provider collection to `collectAndSubmitUsage`.
  - Keep config, device identity, health/version, final message, and `lastSync`.
- Modify: `packages/cli/src/sync.test.ts`
  - Shrink tests around orchestration and add fakes at the collection seam.

---

## Target Interfaces

Use these names unless the implementation exposes a concrete conflict.

```ts
// apps/web/src/server/cli-auth.ts
export type CliAuthSelection = {
  cliToken?: {
    id?: true;
    tokenHash?: true;
  };
  member?: {
    id?: true;
    displayName?: true;
    username?: true;
  };
};

export type AuthenticatedCliContext<Selection extends CliAuthSelection> = {
  token: string;
  tokenHash: string;
  cliToken: Selection["cliToken"] extends object
    ? { [Key in keyof Selection["cliToken"] & string]: string }
    : {};
  member: Selection["member"] extends object
    ? {
        [Key in keyof Selection["member"] & string]: Key extends "username" ? string | null : string;
      }
    : {};
};

export type CliAuthResult<Selection extends CliAuthSelection> =
  | { ok: true; context: AuthenticatedCliContext<Selection> }
  | { ok: false; response: NextResponse<{ error: string }> };

export async function authenticateCliRequest<Selection extends CliAuthSelection>(
  request: NextRequest,
  options: { select: Selection; prisma?: CliAuthPrisma; now?: () => Date },
): Promise<CliAuthResult<Selection>>;

export function unauthorizedCliResponse(): NextResponse<{ error: string }>;
```

```ts
// packages/cli/src/sync-collection.ts
export type SyncCollectionIssue = {
  provider: Provider;
  message: string;
};

export type SyncCollectionResult = {
  failedProviders: SyncCollectionIssue[];
  skippedProviders: SyncCollectionIssue[];
  submitted: number;
};

export async function collectAndSubmitUsage(options: SyncCollectionOptions): Promise<SyncCollectionResult>;
```

---

### Task 1: Deepen CLI Auth Gate

**Files:**
- Modify: `apps/web/src/server/cli-auth.ts`
- Modify: `apps/web/src/server/cli-auth.test.ts`

- [ ] **Step 1: Write failing auth-gate tests**

Add tests like these to `apps/web/src/server/cli-auth.test.ts` while preserving the existing helper tests:

```ts
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  authenticateCliRequest,
  createCliLoginCode,
  createCliTokenExpiration,
  hashSecret,
  isCliLoginExpired,
  unauthorizedCliResponse,
} from "./cli-auth";

function createPrismaMock(result: unknown) {
  return {
    cliToken: {
      findFirst: vi.fn().mockResolvedValue(result),
    },
  };
}

function authRequest(token = "tb_secret") {
  return new NextRequest("https://token-burn.test/api/cli/auth", {
    headers: { authorization: `Bearer ${token}` },
  });
}

it("returns unauthenticated without querying Prisma when bearer token is missing", async () => {
  const prisma = createPrismaMock({ member: { id: "member-1" } });

  const result = await authenticateCliRequest(new NextRequest("https://token-burn.test/api/cli/auth"), {
    prisma,
    select: { member: { id: true } },
  });

  expect(result.ok).toBe(false);
  expect(prisma.cliToken.findFirst).not.toHaveBeenCalled();
});

it("looks up non-revoked non-expired CLI tokens by hashed bearer token", async () => {
  const now = new Date("2026-06-26T12:00:00.000Z");
  const prisma = createPrismaMock({
    id: "cli-token-1",
    tokenHash: hashSecret("tb_secret"),
    member: { id: "member-1", displayName: "Nayan", username: "blnayan" },
  });

  const result = await authenticateCliRequest(authRequest(), {
    prisma,
    now: () => now,
    select: {
      cliToken: { id: true, tokenHash: true },
      member: { id: true, displayName: true, username: true },
    },
  });

  expect(result).toEqual({
    ok: true,
    context: {
      token: "tb_secret",
      tokenHash: hashSecret("tb_secret"),
      cliToken: { id: "cli-token-1", tokenHash: hashSecret("tb_secret") },
      member: { id: "member-1", displayName: "Nayan", username: "blnayan" },
    },
  });
  expect(prisma.cliToken.findFirst).toHaveBeenCalledWith({
    where: {
      tokenHash: hashSecret("tb_secret"),
      revokedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      tokenHash: true,
      member: { select: { id: true, displayName: true, username: true } },
    },
  });
});

it("accepts bearer auth case-insensitively", async () => {
  const prisma = createPrismaMock({ member: { id: "member-1" } });
  const request = new NextRequest("https://token-burn.test/api/cli/auth", {
    headers: { authorization: "bearer tb_secret" },
  });

  const result = await authenticateCliRequest(request, {
    prisma,
    select: { member: { id: true } },
  });

  expect(result.ok).toBe(true);
});

it("returns the standard unauthorized response shape", async () => {
  const response = unauthorizedCliResponse();

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
});
```

- [ ] **Step 2: Run the auth-gate tests and verify they fail**

Run:

```bash
cd apps/web && ./node_modules/.bin/vitest run src/server/cli-auth.test.ts
```

Expected: FAIL because `authenticateCliRequest` and `unauthorizedCliResponse` are not exported yet.

- [ ] **Step 3: Implement the CLI auth gate**

Update `apps/web/src/server/cli-auth.ts` with this shape while keeping all existing helper exports:

```ts
import crypto from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { prisma as prismaClient } from "@/lib/prisma";

export type CliAuthPrisma = {
  cliToken: {
    findFirst(args: unknown): Promise<unknown>;
  };
};

export type CliAuthSelection = {
  cliToken?: {
    id?: true;
    tokenHash?: true;
  };
  member?: {
    id?: true;
    displayName?: true;
    username?: true;
  };
};

type SelectedCliToken<Selection extends CliAuthSelection> = Selection["cliToken"] extends object
  ? { [Key in keyof Selection["cliToken"] & string]: string }
  : {};

type SelectedMember<Selection extends CliAuthSelection> = Selection["member"] extends object
  ? { [Key in keyof Selection["member"] & string]: Key extends "username" ? string | null : string }
  : {};

export type AuthenticatedCliContext<Selection extends CliAuthSelection> = {
  token: string;
  tokenHash: string;
  cliToken: SelectedCliToken<Selection>;
  member: SelectedMember<Selection>;
};

export type CliAuthResult<Selection extends CliAuthSelection> =
  | { ok: true; context: AuthenticatedCliContext<Selection> }
  | { ok: false; response: NextResponse<{ error: string }> };

export async function authenticateCliRequest<Selection extends CliAuthSelection>(
  request: NextRequest,
  {
    prisma = prismaClient as unknown as CliAuthPrisma,
    select,
    now = () => new Date(),
  }: {
    prisma?: CliAuthPrisma;
    select: Selection;
    now?: () => Date;
  },
): Promise<CliAuthResult<Selection>> {
  const token = readBearerToken(request);
  if (!token) return { ok: false, response: unauthorizedCliResponse() };

  const tokenHash = hashSecret(token);
  const record = await prisma.cliToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: now() },
    },
    select: buildCliTokenSelect(select),
  });

  if (!record) return { ok: false, response: unauthorizedCliResponse() };

  const context = buildAuthenticatedContext(record, { token, tokenHash }) as AuthenticatedCliContext<Selection>;
  return { ok: true, context };
}

export function unauthorizedCliResponse(): NextResponse<{ error: string }> {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function buildCliTokenSelect(selection: CliAuthSelection): Record<string, unknown> {
  return {
    ...(selection.cliToken ?? {}),
    ...(selection.member ? { member: { select: selection.member } } : {}),
  };
}

function buildAuthenticatedContext(record: unknown, metadata: { token: string; tokenHash: string }) {
  const value = record as { member?: unknown };
  const { member, ...cliToken } = value;

  return {
    token: metadata.token,
    tokenHash: metadata.tokenHash,
    cliToken,
    member: member ?? {},
  };
}
```

- [ ] **Step 4: Run the auth-gate tests and verify they pass**

Run:

```bash
cd apps/web && ./node_modules/.bin/vitest run src/server/cli-auth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add apps/web/src/server/cli-auth.ts apps/web/src/server/cli-auth.test.ts
git commit -m "refactor: add cli auth gate"
```

---

### Task 2: Migrate Auth And Sync-Windows Routes

**Files:**
- Modify: `apps/web/src/app/api/cli/auth/route.ts`
- Modify: `apps/web/src/app/api/cli/auth/route.test.ts`
- Modify: `apps/web/src/app/api/cli/sync-windows/route.ts`
- Modify: `apps/web/src/app/api/cli/sync-windows/route.test.ts`

- [ ] **Step 1: Update route tests to assert auth-gate behavior**

Keep current response expectations, but remove assertions that duplicate auth lookup internals from route tests. Add a denied-auth test to each route:

```ts
it("returns unauthorized when no valid CLI token exists", async () => {
  prismaMock.cliToken.findFirst.mockResolvedValue(null);

  const response = await GET(createAuthRequest("tb_missing"));

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
});
```

For `sync-windows`, keep the existing invalid `deviceId` test and authenticated provider-window test.

- [ ] **Step 2: Run migrated route tests and verify current behavior still passes**

Run:

```bash
cd apps/web && ./node_modules/.bin/vitest run src/app/api/cli/auth/route.test.ts src/app/api/cli/sync-windows/route.test.ts
```

Expected: PASS before route migration or FAIL only where assertions need to reflect the new auth gate.

- [ ] **Step 3: Replace duplicated auth in `/api/cli/auth`**

Use this route structure in `apps/web/src/app/api/cli/auth/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { authenticateCliRequest } from "@/server/cli-auth";

export async function GET(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: {
        displayName: true,
        username: true,
      },
    },
  });
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    authenticated: true,
    member: {
      displayName: auth.context.member.displayName,
      ...(auth.context.member.username ? { username: auth.context.member.username } : {}),
    },
  });
}
```

- [ ] **Step 4: Replace duplicated auth in `/api/cli/sync-windows`**

Use this route structure in `apps/web/src/app/api/cli/sync-windows/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authenticateCliRequest } from "@/server/cli-auth";
import { buildSyncWindows } from "@/server/sync-windows";

const querySchema = z.object({
  deviceId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: {
        id: true,
      },
    },
  });
  if (!auth.ok) return auth.response;

  const parsed = querySchema.safeParse({
    deviceId: request.nextUrl.searchParams.get("deviceId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync windows request" }, { status: 400 });
  }

  const windows = await buildSyncWindows({
    memberId: auth.context.member.id,
    clientDeviceId: parsed.data.deviceId,
  });

  return NextResponse.json(windows);
}
```

- [ ] **Step 5: Run route and auth tests**

Run:

```bash
cd apps/web && ./node_modules/.bin/vitest run src/server/cli-auth.test.ts src/app/api/cli/auth/route.test.ts src/app/api/cli/sync-windows/route.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add apps/web/src/app/api/cli/auth/route.ts apps/web/src/app/api/cli/auth/route.test.ts apps/web/src/app/api/cli/sync-windows/route.ts apps/web/src/app/api/cli/sync-windows/route.test.ts
git commit -m "refactor: use cli auth gate in auth routes"
```

---

### Task 3: Migrate Sync And Device Routes

**Files:**
- Modify: `apps/web/src/app/api/sync/route.ts`
- Modify: `apps/web/src/app/api/sync/route.test.ts`
- Modify: `apps/web/src/app/api/cli/devices/route.ts`
- Create: `apps/web/src/app/api/cli/devices/route.test.ts`
- Modify: `apps/web/src/app/api/cli/devices/merge/route.ts`
- Create: `apps/web/src/app/api/cli/devices/merge/route.test.ts`

- [ ] **Step 1: Add route tests for device listing and merge**

Create `apps/web/src/app/api/cli/devices/route.test.ts` with these core tests:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: { findFirst: vi.fn() },
  },
}));

vi.mock("@/server/devices", () => ({
  listMemberDevices: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { listMemberDevices } from "@/server/devices";

import { GET } from "./route";

const prismaMock = prisma as unknown as { cliToken: { findFirst: ReturnType<typeof vi.fn> } };
const listMemberDevicesMock = listMemberDevices as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/cli/devices", () => {
  beforeEach(() => {
    prismaMock.cliToken.findFirst.mockReset();
    listMemberDevicesMock.mockReset();
  });

  it("rejects missing auth", async () => {
    const response = await GET(new NextRequest("https://token-burn.test/api/cli/devices"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(listMemberDevicesMock).not.toHaveBeenCalled();
  });

  it("lists devices for the authenticated member", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });
    listMemberDevicesMock.mockResolvedValue({ devices: [], duplicateGroups: [] });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ devices: [], duplicateGroups: [] });
    expect(listMemberDevicesMock).toHaveBeenCalledWith({ memberId: "member-1" });
  });
});

function request() {
  return new NextRequest("https://token-burn.test/api/cli/devices", {
    headers: { authorization: "Bearer tb_secret" },
  });
}
```

Create `apps/web/src/app/api/cli/devices/merge/route.test.ts` with these core tests:

```ts
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: { findFirst: vi.fn() },
  },
}));

vi.mock("@/server/devices", async () => {
  const actual = await vi.importActual<typeof import("@/server/devices")>("@/server/devices");
  return {
    ...actual,
    mergeMemberDevices: vi.fn(),
  };
});

import { prisma } from "@/lib/prisma";
import { DeviceMergeError, mergeMemberDevices } from "@/server/devices";

import { POST } from "./route";

const prismaMock = prisma as unknown as { cliToken: { findFirst: ReturnType<typeof vi.fn> } };
const mergeMemberDevicesMock = mergeMemberDevices as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/cli/devices/merge", () => {
  beforeEach(() => {
    prismaMock.cliToken.findFirst.mockReset();
    mergeMemberDevicesMock.mockReset();
  });

  it("rejects missing auth", async () => {
    const response = await POST(request({ sourceDeviceId: "source", targetDeviceId: "target" }, false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects invalid merge payloads", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });

    const response = await POST(request({ sourceDeviceId: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid merge payload" });
  });

  it("returns device merge domain errors", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });
    mergeMemberDevicesMock.mockRejectedValue(new DeviceMergeError("Both devices must exist for the authenticated member."));

    const response = await POST(request({ sourceDeviceId: "source", targetDeviceId: "target" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Both devices must exist for the authenticated member." });
  });

  it("merges devices for the authenticated member", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });
    mergeMemberDevicesMock.mockResolvedValue({
      sourceDeviceId: "source",
      targetDeviceId: "target",
      deletedDuplicateRows: 1,
      movedRows: 2,
      resolvedConflictRows: 0,
      deletedSourceDevice: true,
    });

    const response = await POST(request({ sourceDeviceId: "source", targetDeviceId: "target" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sourceDeviceId: "source",
      targetDeviceId: "target",
      deletedDuplicateRows: 1,
      movedRows: 2,
      resolvedConflictRows: 0,
      deletedSourceDevice: true,
    });
  });
});

function request(body: unknown, withAuth = true) {
  return new NextRequest("https://token-burn.test/api/cli/devices/merge", {
    method: "POST",
    headers: {
      ...(withAuth ? { authorization: "Bearer tb_secret" } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 2: Run new route tests and verify they fail where routes still duplicate auth**

Run:

```bash
cd apps/web && ./node_modules/.bin/vitest run src/app/api/cli/devices/route.test.ts src/app/api/cli/devices/merge/route.test.ts
```

Expected: tests compile and may PASS before migration, but they protect route behavior before the refactor.

- [ ] **Step 3: Replace duplicated auth in `/api/cli/devices`**

Use this route structure:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { authenticateCliRequest } from "@/server/cli-auth";
import { listMemberDevices } from "@/server/devices";

export async function GET(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: { id: true },
    },
  });
  if (!auth.ok) return auth.response;

  return NextResponse.json(await listMemberDevices({ memberId: auth.context.member.id }));
}
```

- [ ] **Step 4: Replace duplicated auth in `/api/cli/devices/merge`**

Use this route structure:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";

import { authenticateCliRequest } from "@/server/cli-auth";
import { DeviceMergeError, mergeMemberDevices } from "@/server/devices";

const mergeRequestSchema = z.object({
  sourceDeviceId: z.string().min(1),
  targetDeviceId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: { id: true },
    },
  });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);

  try {
    const payload = mergeRequestSchema.parse(body);
    const result = await mergeMemberDevices({
      memberId: auth.context.member.id,
      sourceDeviceId: payload.sourceDeviceId,
      targetDeviceId: payload.targetDeviceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid merge payload" }, { status: 400 });
    }

    if (error instanceof DeviceMergeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
}
```

- [ ] **Step 5: Replace duplicated valid-token lookup in `/api/sync`**

Keep rate limits and payload behavior. Use this core structure:

```ts
const token = readBearerTokenForRateLimit(request);
if (!token) {
  const rateLimit = checkRateLimit({
    key: buildClientRateLimitKey(request, "sync-missing-auth"),
    ...missingAuthLimit,
  });
  if (!rateLimit.ok) return rateLimitResponse(rateLimit);

  return unauthorizedCliResponse();
}

const clientRateLimit = checkRateLimit({
  key: buildClientRateLimitKey(request, "sync-client"),
  ...syncClientLimit,
});
if (!clientRateLimit.ok) return rateLimitResponse(clientRateLimit);

const auth = await authenticateCliRequest(request, {
  select: {
    cliToken: { id: true },
    member: { id: true },
  },
});
if (!auth.ok) return auth.response;

const rateLimit = checkRateLimit({
  key: `sync-token:${auth.context.tokenHash}`,
  ...syncTokenLimit,
});
if (!rateLimit.ok) return rateLimitResponse(rateLimit);
```

Add this local helper only if needed for missing-auth rate limiting:

```ts
function readBearerTokenForRateLimit(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}
```

- [ ] **Step 6: Update `/api/sync` route tests for authenticated persistence**

Add or preserve this assertion:

```ts
expect(persistSyncPayloadMock).toHaveBeenCalledWith({
  cliTokenId: "cli-token-1",
  memberId: "member-1",
  payload: expect.objectContaining({
    provider: "codex",
    cliVersion: requiredCliVersion,
  }),
});
```

- [ ] **Step 7: Run web focused tests**

Run:

```bash
cd apps/web && ./node_modules/.bin/vitest run src/server/cli-auth.test.ts src/app/api/sync/route.test.ts src/app/api/cli/auth/route.test.ts src/app/api/cli/devices/route.test.ts src/app/api/cli/devices/merge/route.test.ts src/app/api/cli/sync-windows/route.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add apps/web/src/app/api/sync/route.ts apps/web/src/app/api/sync/route.test.ts apps/web/src/app/api/cli/devices/route.ts apps/web/src/app/api/cli/devices/route.test.ts apps/web/src/app/api/cli/devices/merge/route.ts apps/web/src/app/api/cli/devices/merge/route.test.ts
git commit -m "refactor: use cli auth gate in sync and device routes"
```

---

### Task 4: Add Sync Collection Module

**Files:**
- Create: `packages/cli/src/sync-collection.ts`
- Create: `packages/cli/src/sync-collection.test.ts`

- [ ] **Step 1: Write failing sync collection tests**

Create `packages/cli/src/sync-collection.test.ts` with tests covering this behavior:

```ts
import { describe, expect, it } from "vitest";

import { UnsupportedCcusageProviderError } from "./ccusage.js";
import { collectAndSubmitUsage } from "./sync-collection.js";

describe("collectAndSubmitUsage", () => {
  it("maps provider windows, builds sync payloads, and submits rows", async () => {
    const submissions: unknown[] = [];

    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: {
        serverTime: "2026-06-01T00:00:00.000Z",
        until: "2026-06-01",
        providers: [{ provider: "claude_code", since: "2026-05-31" }, { provider: "codex" }],
      },
      serverClient: {
        submitSyncPayload: async (submission) => {
          submissions.push(submission);
          return { accepted: true };
        },
      },
      readCcusageVersion: async () => "20.0.6",
      readProviderUsage: async (provider, options) => [
        {
          provider,
          date: "2026-05-31",
          tokenCategories: { input: 10 },
          totalTokens: 10,
          ...(options?.window ? { sourceSnapshot: { totalTokens: 10 } } : {}),
        },
      ],
    });

    expect(result).toEqual({ submitted: 2, failedProviders: [], skippedProviders: [] });
    expect(submissions).toEqual([
      {
        token: "secret",
        payload: expect.objectContaining({
          provider: "claude_code",
          ccusageVersion: "20.0.6",
          deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
          deviceName: "nayan-vps",
          cliVersion: "0.1.0",
          os: "linux",
          syncedAt: "2026-06-01T00:00:00.000Z",
        }),
      },
      {
        token: "secret",
        payload: expect.objectContaining({
          provider: "codex",
          ccusageVersion: "20.0.6",
        }),
      },
    ]);
  });

  it("classifies unsupported ccusage providers as skipped", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readCcusageVersion: async () => "20.0.6",
      readProviderUsage: async (provider) => {
        if (provider === "codex") throw new UnsupportedCcusageProviderError("codex");
        return [];
      },
    });

    expect(result).toEqual({
      submitted: 0,
      failedProviders: [],
      skippedProviders: [
        {
          provider: "codex",
          message: "ccusage does not support Codex usage in the installed version",
        },
      ],
    });
  });

  it("normalizes native binary permission failures", async () => {
    const result = await collectAndSubmitUsage({
      token: "secret",
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: "0.1.0",
      platform: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      syncWindows: { serverTime: "2026-06-01T00:00:00.000Z", until: "2026-06-01", providers: [] },
      serverClient: { submitSyncPayload: async () => ({ accepted: true }) },
      readCcusageVersion: async () => "20.0.6",
      readProviderUsage: async () => {
        throw new Error("ccusage native binary is not executable: EPERM chmod");
      },
    });

    expect(result.failedProviders[0]?.message).toBe(
      "ccusage native binary is not executable because the global npm install is not user-writable. Reinstall @blnayan/token-burn in a user-writable Node environment, or fix the binary execute bit once. Do not run token-burn sync with sudo",
    );
  });
});
```

- [ ] **Step 2: Run the sync collection tests and verify they fail**

Run:

```bash
cd packages/cli && ./node_modules/.bin/vitest run src/sync-collection.test.ts
```

Expected: FAIL because `sync-collection.ts` does not exist.

- [ ] **Step 3: Implement `sync-collection.ts`**

Create `packages/cli/src/sync-collection.ts` with these exports and implementation facts:

```ts
import { syncPayloadSchema, type Provider, type SyncPayload, type SyncWindowsResponse } from "@token-burn/shared";

import type { NormalizedUsageRow, ProviderUsageWindow } from "./ccusage.js";
import {
  isUnsupportedCcusageProviderError,
  readCcusageVersion as readCcusageVersionFromPackage,
  readProviderUsage as readProviderUsageFromCcusage,
} from "./ccusage.js";
import type { TokenBurnServerClient } from "./server-client.js";

type SyncPlatform = Extract<NodeJS.Platform, "darwin" | "linux" | "win32">;

export type SyncCollectionIssue = {
  provider: Provider;
  message: string;
};

export type SyncCollectionResult = {
  failedProviders: SyncCollectionIssue[];
  skippedProviders: SyncCollectionIssue[];
  submitted: number;
};

export type SyncCollectionOptions = {
  token: string;
  deviceId: string;
  deviceName: string;
  cliVersion: string;
  platform: SyncPlatform;
  syncedAt: string;
  syncWindows: SyncWindowsResponse;
  serverClient: Pick<TokenBurnServerClient, "submitSyncPayload">;
  readProviderUsage?: (provider: Provider, options?: { window?: ProviderUsageWindow }) => Promise<NormalizedUsageRow[]>;
  readCcusageVersion?: () => Promise<string>;
};

const supportedProviders: Provider[] = ["claude_code", "codex"];

export async function collectAndSubmitUsage({
  token,
  deviceId,
  deviceName,
  cliVersion,
  platform,
  syncedAt,
  syncWindows,
  serverClient,
  readProviderUsage = readProviderUsageFromCcusage,
  readCcusageVersion = readCcusageVersionFromPackage,
}: SyncCollectionOptions): Promise<SyncCollectionResult> {
  const ccusageVersion = await readCcusageVersion();
  const providerWindows = new Map(syncWindows.providers.map((window) => [window.provider, window]));
  const failures: Array<{ provider: Provider; error: Error }> = [];
  const skipped: Array<{ provider: Provider; error: Error }> = [];
  let submitted = 0;

  for (const provider of supportedProviders) {
    try {
      const providerWindow = providerWindows.get(provider);
      const rows = await readProviderUsage(provider, {
        window: providerWindow?.since ? { since: providerWindow.since, until: syncWindows.until } : undefined,
      });

      for (const row of rows) {
        const payload = buildPayload(row, { cliVersion, ccusageVersion, deviceId, deviceName, platform, syncedAt });
        await serverClient.submitSyncPayload({ token, payload });
        submitted += 1;
      }
    } catch (error) {
      const normalizedError = normalizeProviderError(error);

      if (isSkippableProviderError(error)) {
        skipped.push({ provider, error: normalizedError });
      } else {
        failures.push({ provider, error: normalizedError });
      }
    }
  }

  return {
    failedProviders: failures.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
    skippedProviders: skipped.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
    submitted,
  };
}
```

Move `buildPayload`, `normalizeProviderError`, `isSkippableProviderError`, `isMissingClaudeDataError`, `isCcusageNativeBinaryPermissionError`, `toError`, and `trimTrailingPeriod` from `sync.ts` into this file. Export only `collectAndSubmitUsage` and the public types.

- [ ] **Step 4: Run sync collection tests**

Run:

```bash
cd packages/cli && ./node_modules/.bin/vitest run src/sync-collection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add packages/cli/src/sync-collection.ts packages/cli/src/sync-collection.test.ts
git commit -m "refactor: add sync collection module"
```

---

### Task 5: Wire Sync Usage To Sync Collection

**Files:**
- Modify: `packages/cli/src/sync.ts`
- Modify: `packages/cli/src/sync.test.ts`

- [ ] **Step 1: Add a collection seam to `SyncDependencies` tests**

Update `packages/cli/src/sync.test.ts` so orchestration tests can fake collection directly:

```ts
const collectAndSubmitUsage = async () => ({
  submitted: 1,
  failedProviders: [],
  skippedProviders: [],
});

await syncUsage({
  readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "secret" }),
  writeConfig: async () => {},
  serverClient: matchingServerClient(),
  collectAndSubmitUsage,
  now: () => new Date("2026-06-01T00:00:00.000Z"),
  platform: "linux",
  cliVersion: "0.1.0",
  createDeviceId: () => "4f43b27d-7d86-4ff8-8c98-f74158819e59",
  readDeviceName: () => "nayan-vps",
  log: () => {},
});
```

Keep tests that assert final messages, `lastSync`, failed pre-collection behavior, and all-providers-failed behavior.

- [ ] **Step 2: Run sync tests and verify they fail**

Run:

```bash
cd packages/cli && ./node_modules/.bin/vitest run src/sync.test.ts
```

Expected: FAIL because `SyncDependencies` does not accept `collectAndSubmitUsage` yet and `syncUsage` still owns collection.

- [ ] **Step 3: Update `sync.ts` dependencies and imports**

Replace direct provider collection imports with the collection module:

```ts
import {
  collectAndSubmitUsage as collectAndSubmitUsageFromProviders,
  type SyncCollectionResult,
} from "./sync-collection.js";
```

Update `SyncDependencies`:

```ts
collectAndSubmitUsage?: typeof collectAndSubmitUsageFromProviders;
```

Remove `readProviderUsage` and `readCcusageVersion` from `SyncDependencies` after tests are migrated to the collection seam.

- [ ] **Step 4: Delegate collection inside `syncUsage`**

Replace the provider loop with:

```ts
let collection: SyncCollectionResult;

try {
  const syncWindows = await client.readSyncWindows({ token: config.token, deviceId });
  collection = await collectAndSubmitUsage({
    token: config.token,
    deviceId,
    deviceName,
    cliVersion: version,
    platform,
    syncedAt,
    syncWindows,
    serverClient: client,
  });
} catch (error) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const lastSync = {
    ok: false,
    message: `Submitted 0 usage rows. Failed before provider collection: ${trimTrailingPeriod(normalizedError.message)}.`,
    at: syncedAt,
  } satisfies NonNullable<CliConfig["lastSync"]>;
  await writeConfig({ ...configWithDevice, lastSync });
  throw normalizedError;
}

const message = formatSyncMessage(collection.submitted, collection.failedProviders, collection.skippedProviders);
```

Change `formatSyncMessage` and `formatFailures` to accept issue arrays:

```ts
function formatSyncMessage(submitted: number, failures: SyncProviderIssue[], skipped: SyncProviderIssue[]): string {
  const parts = [`Submitted ${submitted} usage ${submitted === 1 ? "row" : "rows"}`];
  if (failures.length > 0) parts.push(`Failed providers: ${formatFailures(failures)}`);
  if (skipped.length > 0) parts.push(`Skipped providers: ${formatFailures(skipped)}`);
  return `${parts.join(". ")}.`;
}

function formatFailures(failures: SyncProviderIssue[]): string {
  return failures.map(({ provider, message }) => `${provider}: ${trimTrailingPeriod(message)}`).join("; ");
}
```

Return the collection issues directly:

```ts
return {
  failedProviders: collection.failedProviders,
  lastSync,
  skippedProviders: collection.skippedProviders,
  submitted: collection.submitted,
  syncedAt,
};
```

- [ ] **Step 5: Preserve all-supported-providers-failed behavior**

Keep this behavior using collection fields:

```ts
if (collection.submitted === 0 && collection.failedProviders.length > 0) {
  throw new Error(`All supported providers failed: ${formatFailures(collection.failedProviders)}.`);
}
```

- [ ] **Step 6: Run CLI focused tests**

Run:

```bash
cd packages/cli && ./node_modules/.bin/vitest run src/sync-collection.test.ts src/sync.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add packages/cli/src/sync.ts packages/cli/src/sync.test.ts
git commit -m "refactor: delegate sync provider collection"
```

---

### Task 6: Typecheck, Full Test, And Review

**Files:**
- Review all files changed in Tasks 1-5.

- [ ] **Step 1: Run focused web tests**

Run:

```bash
cd apps/web && ./node_modules/.bin/vitest run src/server/cli-auth.test.ts src/app/api/sync/route.test.ts src/app/api/cli/auth/route.test.ts src/app/api/cli/devices/route.test.ts src/app/api/cli/devices/merge/route.test.ts src/app/api/cli/sync-windows/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused CLI tests**

Run:

```bash
cd packages/cli && ./node_modules/.bin/vitest run src/sync-collection.test.ts src/sync.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks**

Run:

```bash
cd packages/shared && ../../node_modules/.bin/tsc -p tsconfig.json
cd ../cli && ./node_modules/.bin/tsc -p tsconfig.json --noEmit
cd ../../ && node scripts/generate-required-cli-version.mjs && cd apps/web && ./node_modules/.bin/tsc -p tsconfig.json --noEmit
```

Expected: all commands exit 0.

- [ ] **Step 4: Run full workspace test suite**

Run:

```bash
corepack pnpm test
```

Expected: PASS for shared, CLI, and web packages.

- [ ] **Step 5: Inspect diff for architecture drift**

Run:

```bash
git diff --stat HEAD~5..HEAD
git diff HEAD~5..HEAD -- apps/web/src/server/cli-auth.ts packages/cli/src/sync.ts packages/cli/src/sync-collection.ts
```

Expected:

- routes no longer repeat bearer parsing, token hashing, valid-token Prisma lookup, or unauthorized helper implementation
- `sync.ts` no longer imports `NormalizedUsageRow`, `ProviderUsageWindow`, or direct ccusage provider readers
- `sync-collection.ts` owns row-to-payload shaping and provider issue classification

- [ ] **Step 6: Confirm no uncommitted cleanup remains**

Run:

```bash
git status --short
```

Expected: no output. If this prints files, stop and inspect each printed path with `git diff -- path/from/status` before deciding whether it belongs in the last task commit.
