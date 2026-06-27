# Tokscale Adapter Design

Date: 2026-06-27
Status: Approved design, pending written spec review

## Goal

Token Burn should use `junhoyeo/tokscale` instead of `ccusage` as the CLI usage source. The replacement should preserve the existing Token Burn sync architecture while expanding provider coverage to all tokscale clients that can be read from local/session data without requiring a separate account login, API sync, or cache refresh step.

The first implementation should support the providers currently covered through `ccusage`, plus additional tokscale local/session clients such as Grok Build where tokscale can read token-attributed usage directly from disk.

## Context

The current CLI collects usage through `packages/cli/src/ccusage.ts`, which shells out to `ccusage <provider> daily --json --timezone UTC`, normalizes the result, and hands `NormalizedUsageRow` objects to `packages/cli/src/sync-collection.ts`.

The web app already stores providers as strings in `DailyProviderUsage` and `DailyModelUsage`, so replacing the local source does not require a database schema change. Most provider constraints live in code-level contracts:

- `packages/shared/src/schemas.ts` defines the public provider registry, labels, and source metadata.
- `packages/cli/src/ccusage.ts` owns source command invocation and normalization.
- `packages/cli/src/sync-collection.ts` owns provider iteration, sync-window mapping, payload construction, and provider issue classification.
- `apps/web/src/server/sync-windows.ts`, member usage queries, and member usage UI derive provider behavior from the shared registry.

Tokscale 4.0.4 is distributed as a native CLI through npm packages. Its public CLI supports JSON report output, `--client` filtering, date filters, and model grouping. Its documented local-client list is broader than `ccusage`; it also includes clients that require separate login/sync/cache flows.

## Provider Scope

The first tokscale-backed Token Burn provider set should include only tokscale clients that are local/session based and token-attributed in a normal report run. It should exclude providers whose data is only available after a separate tokscale account sync or whose data is aggregate request/spend rather than token rows.

Include existing Token Burn providers where tokscale has a local client:

- `claude_code` from tokscale client `claude`
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

Add tokscale local/session clients explicitly, subject to adapter verification:

- `roocode`
- `kilocode`
- `mux`
- `zed`
- `kiro`
- `cline`
- `gjc`
- `grok`
- `jcode`
- `micode`
- `commandcode`
- `antigravity_cli`
- `junie`
- `zcode`

Exclude for this first implementation:

- `cursor`, because tokscale reads Cursor API export caches populated by `tokscale cursor login` and `tokscale cursor sync`.
- `trae`, because tokscale uses account/API sync into a local cache.
- `antigravity` IDE, because tokscale requires `tokscale antigravity sync` against a local language server cache.
- `warp`, because tokscale reports aggregate requests/spend and explicitly does not provide token transcripts.
- `crush`, because tokscale marks it outside its default submit set; include later only after confirming its token attribution semantics are appropriate for Token Burn.
- `synthetic`, because it is derived from other agent sessions and could double count unless modeled separately.

Future providers should be added intentionally through the shared registry, not discovered dynamically from tokscale help output.

## Options Considered

### Replace ccusage Adapter With Tokscale Adapter

Create a tokscale-specific adapter that invokes `tokscale` JSON reports, normalizes rows into Token Burn's existing `NormalizedUsageRow` shape, and updates sync collection to use source-neutral naming. The server and database contract remain stable.

This is the recommended approach because it keeps one usage source, preserves per-provider sync windows, and avoids maintaining two normalization systems.

### One Aggregate Tokscale Report Per Sync

Call `tokscale models --json` once across all supported clients and split results by `client`. This would reduce subprocess count and align with tokscale's normal multi-client report flow, but it complicates Token Burn's per-provider incremental sync windows.

### Tokscale Only For Extra Providers

Keep `ccusage` for existing providers and use tokscale for additional providers such as Grok. This lowers migration risk, but it creates two source adapters, two cost semantics, and unclear precedence if both sources can read the same client.

## Architecture

Replace `packages/cli/src/ccusage.ts` with a tokscale-focused adapter, likely `packages/cli/src/tokscale.ts`. Keep the normalized output boundary intact so `sync-collection.ts` can continue to build and validate the existing `SyncPayload` shape.

`packages/shared/src/schemas.ts` should remain the source of truth for Token Burn provider IDs and labels. Its provider metadata should become source-neutral or tokscale-specific. For example, replace `ccusageCommand` with a field such as `tokscaleClient`. Existing provider IDs should stay stable where possible:

- Keep `claude_code` as Token Burn's provider ID while mapping it to tokscale client `claude`.
- Keep direct IDs such as `codex`, `opencode`, `gemini`, `amp`, `copilot`, `qwen`, and `grok` aligned with tokscale client IDs.
- Use underscore IDs when Token Burn naming needs to avoid hyphenated client IDs, such as `antigravity_cli` mapping to tokscale client `antigravity-cli`.

The web app should continue deriving provider filters, sync windows, and display labels from the shared registry. No database migration is needed for provider expansion.

## Data Flow

1. The CLI asks the web app for sync windows.
2. The web app returns one provider window entry for every supported Token Burn provider.
3. The CLI loops over the shared provider registry in order.
4. For each provider, the tokscale adapter invokes tokscale filtered to the mapped client, using JSON output and a grouping that preserves provider/model token buckets.
5. The adapter normalizes tokscale rows into `NormalizedUsageRow` objects:
   - Token Burn provider ID comes from the registry mapping.
   - Tokscale model rows become `models`.
   - `input`, `output`, `cacheRead`, and `cacheWrite` map into Token Burn token categories.
   - `reasoning` maps into `tokenDetails.reasoningOutput`.
   - `cost` maps to `costUsd`.
   - tokscale client/provider/model/raw token fields are retained in `sourceSnapshot` or `costMetadata`.
6. `sync-collection.ts` builds and validates `SyncPayload` objects.
7. The server ingests rows into the existing daily provider and model usage tables.
8. Leaderboard totals and member usage views include the new providers through existing queries.

## Date Handling

Token Burn stores daily rows by UTC date. Tokscale report filters are documented as date filters for report commands and are oriented around the CLI report view. The adapter should favor correctness over minimizing subprocess calls.

The implementation should choose a tokscale JSON path that can produce date-bucketed output. If the selected report shape exposes timestamps or daily buckets, the adapter should request a broad provider window and bucket normalized output by UTC date. If the model JSON report does not expose enough date information, the adapter should call tokscale for one day at a time and treat each invocation as that Token Burn UTC date.

Provider sync windows remain inclusive in Token Burn terms:

- If the server returns no `since`, collect the provider's available history.
- If the server returns `since`, collect from `since` through server `until`.
- Never depend on the user's local timezone to decide the stored Token Burn date unless tokscale only exposes local-day aggregates; in that case, the limitation should be captured in adapter tests and source metadata.

## Source Version And Payload Naming

The first implementation should avoid a database migration solely to rename `ccusageVersion`. The underlying DB column and existing rows can stay as-is.

In code, prefer source-neutral naming such as `usageSourceVersion` where the value is produced. The sync payload schema can continue carrying the existing field name temporarily if that avoids a broad API migration, but it should be filled with the tokscale package/CLI version.

`costSource` should allow `"tokscale"` for new rows while continuing to tolerate old `"ccusage"` rows already stored in the database.

User-facing text and docs should refer to tokscale as the active source after the adapter replacement.

## Error Handling And Compatibility

Missing local data for a tokscale client should be a skipped provider, not a failed sync. Unsupported platform/client messages should also be skipped when they clearly mean tokscale cannot scan that provider on the current machine.

Unexpected failures remain provider failures:

- invalid JSON
- schema mismatches
- malformed token totals
- subprocess crashes
- permission errors
- normalization errors

A failure for one provider should not stop other providers from syncing. Pre-collection failures, such as being unable to determine the tokscale version, may still fail sync before provider iteration.

The CLI's summary behavior should remain stable:

- submitted rows are counted across all providers
- skipped providers are reported separately from failed providers
- provider-level failures do not prevent other providers from syncing

## Testing

Shared schema tests should prove:

- the expanded tokscale-backed provider list is accepted
- unknown providers are rejected
- provider labels and tokscale client mappings are stable
- old and new cost source values validate where needed

CLI adapter tests should prove:

- each supported provider maps to the expected tokscale client
- the adapter invokes tokscale with JSON output and the selected grouping/date flags
- missing local data is classified as skippable
- unsupported current-platform/client output is classified as skippable
- invalid JSON and malformed rows are provider failures
- version lookup returns the installed tokscale version

Normalization tests should prove:

- token buckets map correctly from tokscale fields
- reasoning tokens map to `tokenDetails`
- cache read/write map to Token Burn categories
- costs map to `costUsd` and use `costSource: "tokscale"`
- model usage rows sum to provider totals
- UTC date bucketing is deterministic

Sync collection tests should prove:

- collection iterates every shared provider
- provider sync windows are passed to the adapter correctly
- skipped and failed provider issue shapes remain stable
- payloads from new providers validate and submit

Web tests should prove:

- sync-window construction returns every supported provider
- member usage filters accept new provider IDs
- provider labels render readable names
- existing leaderboard and member usage behavior remains unchanged

## Non-Goals

- Do not implement Cursor login/sync/cache support.
- Do not implement Trae login/sync/cache support.
- Do not implement Antigravity IDE sync support.
- Do not ingest Warp aggregate request counters.
- Do not dynamically discover providers from tokscale help output.
- Do not add a database migration solely to rename `ccusageVersion`.
- Do not redesign leaderboard or member usage UI.
- Do not keep `ccusage` as a fallback usage source in the first replacement.

## Success Criteria

- Token Burn uses tokscale instead of ccusage for local usage collection.
- Existing Claude Code and Codex provider IDs keep working.
- Token Burn supports the current ccusage-backed providers plus selected tokscale local/session clients, including Grok Build.
- Providers that need separate login/sync flows are intentionally excluded and reported as future scope.
- New rows can be attributed to tokscale for cost/source metadata.
- The server API and database continue to ingest existing daily provider/model usage payloads without a migration.
- Provider failures and skipped providers remain isolated to individual providers.
