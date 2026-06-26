# All ccusage Data Sources Design

Date: 2026-06-26
Status: Approved design, pending written spec review

## Goal

Token Burn should sync every data source supported by the pinned `ccusage` package version instead of limiting sync to Claude Code and Codex. Each source should appear as its own provider in Token Burn, following the same provider-shaped sync, storage, leaderboard, and member usage patterns that already exist for `claude_code` and `codex`.

The supported provider set should match `ccusage` 20.0.6. Future ccusage sources should be added intentionally through the shared provider registry rather than discovered dynamically at runtime.

- `claude_code`
- `codex`
- `opencode`
- `amp`
- `droid`
- `codebuff`
- `hermes`
- `pi`
- `goose`
- `kilo`
- `copilot`
- `gemini`
- `kimi`
- `qwen`
- `openclaw`

## Context

The database already stores providers as strings in `DailyProviderUsage` and `DailyModelUsage`, so adding providers does not require a schema migration. The current limits live in code-level contracts:

- `packages/shared/src/schemas.ts` defines public provider IDs as `claude_code | codex`.
- `packages/cli/src/sync-collection.ts` iterates a local two-provider list.
- `packages/cli/src/ccusage.ts` only accepts and maps Claude Code and Codex provider commands.
- `apps/web/src/server/sync-windows.ts` returns windows from the shared provider list.
- Member usage filters and UI provider labels only understand the two current providers.

The recent sync-collection and member-usage refactors already created useful boundaries. This work should extend those boundaries rather than reshape them.

## Non-Goals

- Do not add a database migration.
- Do not redesign the leaderboard or member usage UI.
- Do not use aggregate `ccusage daily --all` ingestion.
- Do not dynamically discover providers by parsing `ccusage --help`.
- Do not accept arbitrary provider strings in public APIs.
- Do not add user-defined provider IDs.

## Options Considered

### Static Provider Registry

Add every supported ccusage source to a shared provider registry and map each Token Burn provider ID to a focused `ccusage <source> daily` command. This keeps current per-provider sync windows, tests, payload validation, and UI filtering intact.

This is the recommended approach because it matches the existing Codex and Claude Code pattern and keeps the public API contract explicit.

### Dynamic Provider Discovery

Parse `ccusage --help` or related package metadata to discover provider commands at runtime. This could pick up future ccusage sources without code changes, but help output is not a stable API. The web app and shared schemas would still need a known public provider contract, so discovery would add fragility without removing much maintenance.

### Aggregate ccusage Ingestion

Call `ccusage daily --all --json` once and split rows by source when source identity is available. This could reduce subprocess count, but it does not align with per-provider sync windows and depends on aggregate JSON preserving provider identity in the shape Token Burn needs.

## Architecture

`packages/shared` should become the source of truth for supported provider IDs and display metadata. The provider schema should accept the ccusage-backed provider IDs above, and exported provider arrays should keep a stable order for sync and UI rendering.

`packages/cli/src/ccusage.ts` should own provider-to-command mapping:

- `claude_code` maps to `ccusage claude daily --json --timezone UTC --breakdown`.
- `codex` maps to `ccusage codex daily --json --timezone UTC`.
- Other providers map to their matching ccusage source command, such as `opencode`, `amp`, `gemini`, and `openclaw`.
- Claude Code keeps the current fallback behavior that retries without `--breakdown` when the installed ccusage version does not support it.

`packages/cli/src/sync-collection.ts` should iterate the shared provider list instead of a local two-item list. It should continue to own ccusage version lookup, provider window mapping, row-to-payload shaping, schema validation, provider error classification, and submitted row counting.

`apps/web/src/server/sync-windows.ts` should continue to derive sync windows from the shared provider list. New providers with no existing rows should be returned without `since`, causing the CLI to collect full history for that provider once.

Member usage query parsing, response schemas, and components should accept the expanded provider set. Provider display labels should come from shared metadata so CLI, API, and UI code use the same provider names.

## Data Flow

1. The CLI asks the web app for sync windows.
2. The web app returns one provider window entry for every supported provider.
3. The CLI loops over the shared providers in order.
4. For each provider, the CLI invokes the focused `ccusage <source> daily --json --timezone UTC` command, adding `--since` and `--until` when the server returned an incremental window.
5. The ccusage adapter normalizes daily rows with the existing provider-agnostic logic for token aliases, costs, token details, source snapshots, and model usage.
6. The sync collection module builds and validates `SyncPayload` objects.
7. The server ingests the payloads into the existing daily provider and model usage tables.
8. Leaderboard totals, member usage provider breakdowns, model breakdowns, device filters, and device merges include the new providers naturally through existing database queries.

Existing `claude_code` and `codex` provider IDs do not change.

## Error Handling And Compatibility

Older or mismatched ccusage versions may not support every provider command. A clear unsupported-command error should be classified as a skipped provider issue, so rollout does not fail the whole sync for users with an older installed package.

Missing local data for a provider should be skipped when the error clearly means that provider has no usable local data. Claude Code already has a missing-data classifier; this should be generalized carefully enough to cover the new ccusage sources without swallowing unrelated failures.

Unexpected subprocess failures, JSON parse failures, normalization errors, and schema validation failures should remain failed provider issues.

The current sync message behavior should remain the guidepost:

- submitted rows are counted across all providers
- skipped providers are reported separately from failed providers
- provider-level failures do not prevent other providers from syncing
- pre-collection failures still fail the sync before provider iteration

If all providers produce no submitted rows and only skipped issues, the implementation may clarify the final message, but it should not introduce a broad behavior redesign.

## Testing

Shared schema tests should prove:

- every supported ccusage provider ID is accepted
- unknown public providers are rejected
- sync payload, member usage provider breakdown, and model breakdown schemas accept the expanded provider set

CLI ccusage adapter tests should prove:

- each provider maps to the expected `ccusage <source> daily --json --timezone UTC` command
- date windows are appended consistently for every provider
- Claude Code keeps `--breakdown` and fallback behavior
- fixture mode can read provider-named fixture files for at least one new provider
- unsupported provider command errors are classified as skippable

Sync collection tests should prove:

- collection iterates every shared provider
- per-provider sync windows are mapped correctly
- unknown server windows are ignored
- payloads from a new provider validate and submit
- skipped and failed provider issue shapes remain stable

Web tests should prove:

- sync-window construction returns every supported provider
- member usage query parsing accepts new provider and model filters
- member usage response schemas accept expanded providers
- provider labels render readable names such as `OpenCode`, `GitHub Copilot CLI`, `Gemini CLI`, and `Claude Code`

Focused verification should include shared schema tests, CLI ccusage and sync collection tests, sync-window tests, member usage query tests, member usage component tests, and workspace typechecks.

## Success Criteria

- Token Burn sync attempts every source in the shared ccusage 20.0.6 provider registry as a separate provider.
- Existing Claude Code and Codex behavior remains compatible.
- New providers use the same daily payload shape, incremental sync windows, server ingestion, and member usage filters as existing providers.
- Public APIs remain explicit and reject unknown provider IDs.
- No database migration or leaderboard redesign is required.
