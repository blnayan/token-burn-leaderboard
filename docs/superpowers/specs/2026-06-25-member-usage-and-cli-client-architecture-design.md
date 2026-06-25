# Member Usage And CLI Client Architecture Design

## Goal

Deepen the first two architecture review candidates in one combined implementation:

- Member usage detail should move behind an application-facing query seam.
- CLI server communication should move behind a typed Token Burn server client seam.

This is a behavior-preserving architecture refactor. Internal call shapes may change where routes, commands, and tests currently depend on implementation choreography. Public API response shapes, CLI command behavior, UI behavior, and database schema should remain unchanged.

## Context

The current member usage path has meaningful domain behavior in `apps/web/src/server/leaderboard.ts`, including period/range handling, filter semantics, filtered query planning, cost allocation, trend zero-fill, provider/model/device breakdowns, and public response shaping. Some of that interface leaks into `apps/web/src/app/api/leaderboard/members/[username]/route.ts` and the member usage dialog, especially the rule that provider and model filters are mutually exclusive while device filters can combine with either.

The current CLI server communication seam is `packages/cli/src/http.ts`, but callers still build endpoint paths, normalize URLs, parse endpoint responses, and sometimes duplicate HTTP behavior. Health parsing exists in `sync`, `status`, and `doctor`; `devices` has its own `getJson` implementation.

## Architecture

### Member Usage Query Seam

Create a member usage query module under `apps/web/src/server` that owns the full member usage detail use case.

The module should own:

- transport-independent query shape
- period/range normalization
- provider/model/device filter semantics
- provider/model mutual exclusion
- query planning for summary, trend, provider breakdown, model breakdown, and device breakdown
- model cost allocation when model costs are missing
- UTC trend zero-fill behavior
- shaping the existing `MemberUsageDetail` response

The route should become thin. It should read `username` and `URLSearchParams`, call the member usage query module, translate expected validation/not-found outcomes into HTTP responses, and return the existing shared schema output.

Use pattern ideas only where they reduce coupling:

- Query Object for normalized member usage request semantics.
- Mapper functions for converting persistence rows into public response sections.
- No generic repository abstraction unless the implementation needs it for locality.

### CLI Server Client Seam

Create a typed Token Burn server client under `packages/cli/src`.

The client should own:

- server URL normalization
- endpoint path construction
- bearer token headers
- JSON response parsing
- HTTP error normalization
- endpoint-specific response schema parsing
- endpoint methods used by sync, setup, status, doctor, login, and devices for the scoped calls listed below

The first implementation should at least cover the duplicated and highest-friction paths:

- read CLI health
- validate CLI auth
- read sync windows
- submit sync payload
- start CLI login
- poll CLI login
- list devices
- merge devices

Commands and `syncUsage` should call typed methods rather than assemble URLs and parse responses locally. A production fetch adapter should sit behind the client. Tests can provide method-level fakes for command and sync behavior.

Use pattern ideas only where they fit:

- Facade for the Token Burn server client.
- Adapter for fetch versus method-level test fakes.
- Endpoint schemas near the client methods or imported shared schemas where they already exist.

## Data Flow

### Member Usage

1. The route receives `username` and `URLSearchParams`.
2. The member usage query module parses and validates semantic query input.
3. The query module normalizes the period/range and filters.
4. The query module chooses the correct persistence reads.
5. The query module applies cost allocation and trend zero-fill.
6. The query module returns the existing `MemberUsageDetail` shape.
7. The route validates the output with `memberUsageDetailSchema` and returns JSON.

The normalized query should have one clear filter invariant: provider filters and model filters cannot both be active; device filters may combine with either provider filters or model filters.

### CLI Server Communication

1. Commands and sync orchestration read local config and construct domain inputs.
2. They call the Token Burn server client.
3. The client builds URLs, attaches auth, parses JSON, validates response shape, and throws expected errors.
4. Commands and sync orchestration keep their current result formatting and user-visible messages.

This removes duplicated health parsing in `sync`, `status`, and `doctor`, and removes the local HTTP clone in `devices`.

## Error Handling And Compatibility

### Member Usage

Keep current public API behavior:

- invalid range returns `400`
- invalid provider filter returns `400`
- invalid model filter returns `400`
- empty device filter returns `400`
- combined provider and model filters return `400`
- unknown member returns `404`
- valid requests return the same `MemberUsageDetail` schema

The refactor should move validation and filter invariants behind the query seam without changing the caller-visible result.

### CLI Server Client

Keep current CLI behavior and messages as much as practical:

- auth failures should still drive existing login/setup/status behavior
- version mismatch behavior should remain unchanged
- malformed JSON should still produce an expected JSON error
- HTTP error messages should preserve server `error` text when present

Avoid a broad error hierarchy. Keep `HttpError` where callers currently need status-aware behavior, and use normal `Error` values where callers already expect message-only failures.

## Testing

### Member Usage

Keep the existing behavioral coverage and shift brittle assertions toward the new seam:

- query parsing accepts current `range`, `period`, repeated `provider`, repeated `model`, and repeated `device` params
- provider/model mutual exclusion still rejects with `400`
- summary, trend, provider/model/device breakdowns still apply filters correctly
- model-cost fallback behavior remains covered
- route tests verify HTTP status and schema behavior, not the old internal filter object

### CLI Server Client

Add focused server client tests for:

- URL normalization
- bearer auth headers
- endpoint paths
- schema parsing
- HTTP error handling
- malformed JSON
- endpoint methods

Update command and sync tests so:

- `syncUsage` fakes the server client for health, sync windows, and payload submission
- `status`, `doctor`, and `devices` fake the server client rather than duplicating fetch behavior
- user-visible command output tests remain intact

Focused verification after implementation:

```text
pnpm --filter @token-burn/web test -- src/server/leaderboard.test.ts src/app/api/leaderboard/members/[username]/route.test.ts
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts src/commands/status.test.ts src/commands/doctor.test.ts src/commands/devices.test.ts
pnpm --filter @token-burn/web typecheck
pnpm --filter @blnayan/token-burn typecheck
```

## Out Of Scope

- Public API response shape changes.
- CLI command behavior changes.
- UI redesign.
- Database schema changes.
- New provider support.
- A generic repository layer for all Prisma access.
- A sweeping error hierarchy.

## Success Criteria

- Member usage routes and tests no longer need to know internal filter object choreography.
- Member usage behavior remains unchanged for ranges, filters, cost allocation, trend filling, and breakdowns.
- CLI commands and sync no longer duplicate endpoint path, URL normalization, health parsing, or JSON parsing behavior.
- CLI command output remains stable.
- The new seams are deep enough that tests can fake behavior at the use-case/client method level.
