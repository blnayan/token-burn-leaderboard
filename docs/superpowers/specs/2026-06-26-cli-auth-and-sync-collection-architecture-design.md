# CLI Auth And Sync Collection Architecture Design

## Goal

Deepen architecture review candidates 3 and 4 in one combined implementation:

- Web CLI routes should authenticate through one deeper CLI auth gate module.
- CLI sync should collect provider usage through one deeper sync collection module.

This is primarily a behavior-preserving architecture refactor. Internal call shapes and tests may change. Public route responses may change only when the new response shape clearly reduces caller complexity enough to justify the compatibility cost. At the start of implementation, no public response change is expected.

## Context

The web app already has `apps/web/src/server/cli-auth.ts`, but it mostly contains token creation and hashing helpers. Authenticated CLI routes repeat the real auth interface: bearer-token parsing, token hashing, non-revoked and non-expired token lookup, member selection, and `401` response shaping. That repetition appears in `/api/sync`, `/api/cli/auth`, `/api/cli/devices`, `/api/cli/devices/merge`, and `/api/cli/sync-windows`.

The CLI already has a typed Token Burn server client after the previous architecture refactor. `syncUsage` is still doing too much provider collection work directly: ccusage version lookup, provider iteration, sync-window mapping, provider reads, row-to-payload shaping, provider error normalization, skipped-versus-failed classification, submission counting, and some provider-specific failure knowledge.

## Architecture

### CLI Auth Gate Module

Deepen `apps/web/src/server/cli-auth.ts` so routes cross one CLI auth gate seam instead of repeating auth implementation facts.

The module should own:

- bearer-token extraction from `NextRequest`
- secret hashing for CLI tokens
- non-revoked and non-expired token lookup
- member and token context selection for authenticated routes
- standard unauthorized response construction
- a small authenticated result shape that routes can branch on

Routes should keep route-specific behavior:

- `/api/sync` keeps sync payload parsing, required CLI version enforcement, sync ingest, and rate limiting.
- `/api/cli/auth` keeps authenticated member response shaping.
- `/api/cli/devices` keeps device listing.
- `/api/cli/devices/merge` keeps merge payload validation and device merge domain errors.
- `/api/cli/sync-windows` keeps `deviceId` query validation and sync-window construction.

Use pattern ideas only where they reduce coupling:

- Facade-like auth gate for route callers.
- Adapter seam for Prisma-backed lookup versus focused tests.
- No generic route framework or broad repository layer.

### Sync Collection Module

Add `packages/cli/src/sync-collection.ts`.

The module should own:

- ccusage version lookup
- supported provider iteration
- sync-window mapping from server response to provider reads
- provider usage reads
- normalized ccusage row to `SyncPayload` shaping
- `syncPayloadSchema` validation before submission
- provider error normalization
- skipped-versus-failed provider classification
- submitted-row counting

`syncUsage` should keep orchestration behavior:

- config read/write
- missing-token login guidance
- server client creation
- CLI health and required-version check
- device id and device name resolution
- pre-collection failure `lastSync` write
- final sync message formatting
- final `lastSync` write
- existing all-supported-providers-failed throw
- logging

This keeps the sync collection module deep without making it responsible for config, login guidance, or user-facing command output.

## Data Flow

### Authenticated CLI Web Routes

1. A route calls the CLI auth gate with the incoming `NextRequest` and the context fields it needs.
2. The auth gate reads the bearer token, hashes it, verifies a non-revoked and non-expired CLI token, and returns an authenticated context or an unauthorized result.
3. The route returns the auth module's standard unauthorized response when authentication fails.
4. The route uses the authenticated context for route-specific work when authentication succeeds.

The default public unauthorized response remains:

```json
{ "error": "Unauthorized" }
```

with HTTP status `401`.

### CLI Sync Collection

1. `syncUsage` reads config and confirms a token is available.
2. `syncUsage` creates or receives the Token Burn server client.
3. `syncUsage` reads server health and enforces the required CLI version.
4. `syncUsage` resolves device id, device name, platform, CLI version, and sync timestamp.
5. `syncUsage` reads sync windows from the server.
6. `syncUsage` calls the sync collection module with token, device metadata, sync windows, timestamp, platform, CLI version, and server client.
7. The collection module reads ccusage version, collects each supported provider, builds validated sync payloads, submits them, and returns submitted count plus skipped and failed provider issues.
8. `syncUsage` formats the final message, writes `lastSync`, logs, and throws the existing all-supported-providers-failed error when applicable.

## Error Handling And Compatibility

### CLI Auth Gate

Keep current expected auth behavior:

- missing bearer token returns `401`
- invalid, revoked, expired, or missing CLI token returns `401`
- expected auth failures return `{ "error": "Unauthorized" }`
- unrelated Prisma and route errors are not swallowed

`/api/sync` has rate-limit behavior that should remain explicit:

- missing-auth rate limiting stays route-owned because it depends on client request identity
- token-based sync rate limiting may use an auth-gate-provided token hash if it reduces duplicate hashing without widening the route interface

Route-specific errors stay route-owned:

- invalid sync payload returns `400`
- required CLI version mismatch returns `426`
- invalid sync-window request returns `400`
- invalid merge payload returns `400`
- device merge domain errors return `400`

### Sync Collection

Keep current expected sync behavior:

- unsupported ccusage provider and missing Claude data remain skippable provider issues
- ccusage native binary permission errors keep the current helpful message
- provider failures return structured failed provider issues
- pre-collection failures, such as sync-window lookup failure or ccusage version lookup failure, still drive the existing failed `lastSync` message from `syncUsage`
- final sync messages and all-supported-providers-failed throw behavior remain owned by `syncUsage`

Avoid a broad error hierarchy. The collection module should return structured issues for expected provider outcomes and use normal `Error` values for unexpected failures.

## Testing

### Web Auth Tests

Move auth choreography coverage into `apps/web/src/server/cli-auth.test.ts`:

- bearer parsing accepts `Bearer <token>` case-insensitively
- missing bearer token returns unauthenticated without querying Prisma
- missing, revoked, or expired token returns unauthenticated
- valid token returns only the requested authenticated context
- unauthorized response shape remains stable

Route tests should become thinner:

- each authenticated route verifies `401` behavior when the auth gate denies access
- each route verifies its route-specific success path with authenticated context
- existing route-specific errors remain covered
- add route tests for device listing and device merging if those routes need route-level coverage after moving auth choreography into the auth module

### Sync Collection Tests

Add focused `packages/cli/src/sync-collection.test.ts` coverage:

- provider windows are mapped correctly
- missing `since` means full-history provider collection
- unknown server provider windows are ignored
- ccusage rows become schema-validated sync payloads with device and version metadata
- provider failures are classified as failed or skipped
- native binary permission errors normalize to the current helpful message
- submitted count and provider issue shapes are stable

`packages/cli/src/sync.test.ts` should shrink toward orchestration behavior:

- missing-token login guidance
- health and required-version prerequisite
- config device identity write
- failed pre-collection `lastSync`
- final message, log, and `lastSync` behavior
- all-supported-providers-failed throw

Focused verification after implementation:

```text
cd apps/web && ./node_modules/.bin/vitest run src/server/cli-auth.test.ts src/app/api/sync/route.test.ts src/app/api/cli/auth/route.test.ts src/app/api/cli/devices/route.test.ts src/app/api/cli/devices/merge/route.test.ts src/app/api/cli/sync-windows/route.test.ts
cd packages/cli && ./node_modules/.bin/vitest run src/sync-collection.test.ts src/sync.test.ts
cd packages/shared && ../../node_modules/.bin/tsc -p tsconfig.json
cd packages/cli && ./node_modules/.bin/tsc -p tsconfig.json --noEmit
node scripts/generate-required-cli-version.mjs && cd apps/web && ./node_modules/.bin/tsc -p tsconfig.json --noEmit
corepack pnpm test
```

## Out Of Scope

- Database schema changes.
- New provider support.
- CLI command behavior changes.
- UI changes.
- Generic repository abstractions for all Prisma access.
- A generic route wrapper framework.
- A sweeping error hierarchy.

## Success Criteria

- CLI-authenticated routes no longer repeat bearer parsing, token hashing, valid-token lookup, or unauthorized response construction.
- Route tests assert route behavior instead of Prisma auth choreography, except in the auth module tests.
- `syncUsage` no longer owns provider collection details or row-to-payload shaping.
- Provider collection behavior is testable through the sync collection module interface.
- Public route responses and CLI user-visible behavior remain stable unless an explicitly justified response change is introduced during implementation.
- The new modules provide leverage and locality without creating pass-through abstractions.
