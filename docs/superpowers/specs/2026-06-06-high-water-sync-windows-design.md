# High-Water Sync And Server-Directed Windows

Token Burn should prevent aggregate usage totals from going down when local `ccusage` history changes, and it should avoid asking `ccusage` to rescan all history on every scheduled sync. The server will become the source of truth for both leaderboard high-water marks and provider-specific sync windows.

## Goals

- Keep leaderboard totals from decreasing when local Claude Code or Codex session data is deleted after a successful sync.
- Let the server tell the CLI which UTC date range to collect for each provider.
- Keep provider absence graceful: users can have only Claude Code data, only Codex data, both, or neither.
- Preserve the existing aggregate-only privacy boundary. The server still stores daily totals, model names, costs, device metadata, and sync metadata, not prompts, sessions, or paths.
- Design the sync-window API so future providers can be added without changing the response shape.

## Non-Goals

- Do not add local CLI checkpoint logic for optimization. The CLI should not use local `lastSync` to decide `--since`.
- Do not add raw `ccusage` rows, session IDs, project paths, or prompt content.
- Do not add user-managed provider preferences.
- Do not solve rare legitimate downward corrections automatically. Admin repair tooling can be a later feature if needed.

## Current Behavior

The CLI runs one `ccusage daily` command per supported provider and submits daily aggregate rows to `/api/sync`. The server upserts `DailyProviderUsage` by internal `deviceId + provider + date` and overwrites the stored totals with the incoming snapshot.

This is idempotent for repeated identical syncs, but it means a later lower `ccusage` total can lower the leaderboard. That can happen if local conversation/session files are manually deleted before a later sync.

The CLI also currently asks `ccusage` for all daily history on every sync. This works, but it is slower than necessary after the server already has historical rows.

## High-Water Mark Persistence

`/api/sync` will enforce a high-water rule per internal device, provider, and UTC date:

1. If no `DailyProviderUsage` row exists, create it from the incoming payload and create any incoming model rows.
2. If a row exists and the incoming `totalTokens` is greater than or equal to the stored `totalTokens`, accept the incoming snapshot:
   - update token categories
   - update token details
   - update total tokens
   - update cost fields
   - update source snapshot
   - update CLI and `ccusage` versions
   - update OS and `syncedAt`
   - replace child `DailyModelUsage` rows for that provider/date
3. If a row exists and the incoming `totalTokens` is lower than the stored `totalTokens`, preserve the stored leaderboard snapshot:
   - keep existing token totals, categories, details, costs, source snapshot, versions, OS, and `syncedAt`
   - do not delete or recreate child model rows
   - still update `Device.lastSeenAt`
   - still update `CliToken.lastUsedAt`

Equal totals are accepted so newer CLI or `ccusage` versions can refresh model/cost metadata without changing the score.

This keeps public leaderboard math simple: `getLeaderboard` can continue summing `DailyProviderUsage.totalTokens`.

## Sync Window API

Add an authenticated CLI endpoint:

```text
GET /api/cli/sync-windows?deviceId=<uuid>
```

The endpoint uses the existing bearer CLI token authentication pattern. The `deviceId` query parameter is the client device UUID from the CLI config. If the CLI does not yet have a device ID, it should create one before requesting windows, just as sync already creates one before posting payloads.

Response shape:

```json
{
  "serverTime": "2026-06-06T12:00:00.000Z",
  "until": "2026-06-06",
  "providers": [
    { "provider": "claude_code", "since": "2026-06-05" },
    { "provider": "codex", "since": "2026-06-06" }
  ]
}
```

`until` is always the server's current UTC date. Each provider entry is provider-specific:

- `provider` is a provider supported by the server schema.
- `since` is the UTC date of the latest stored `DailyProviderUsage.syncedAt` for this member, client device ID, and provider.
- `since` is omitted when the server has no stored usage rows for that member, client device ID, and provider.

The server should return entries for all server-known providers, not only providers previously seen for the device. This lets the CLI decide which local adapters it supports and lets missing local data remain a provider-level skip.

Provider windows must be calculated independently. A successful Codex sync must not advance the Claude Code window, and a successful Claude Code sync must not advance the Codex window.

## CLI Collection Flow

`syncUsage` will fetch sync windows before invoking `ccusage`.

High-level flow:

1. Read config and ensure the CLI is authenticated.
2. Ensure a client device ID exists and persist it before requesting windows.
3. Fetch `/api/cli/sync-windows?deviceId=<deviceId>` with the CLI bearer token.
4. Use the response `until` date for all provider collection.
5. For each provider supported by the local CLI:
   - find the matching server window entry
   - if `since` exists, run `ccusage <provider> daily --json --timezone UTC --since YYYYMMDD --until YYYYMMDD`
   - if `since` is omitted, run the existing full-history command for that provider
   - post each returned daily row to `/api/sync`
   - if the provider has no local data, record it as a skipped provider and continue
   - if the provider fails unexpectedly, record it as a failed provider and continue
6. Write `lastSync` based on submitted rows, skipped providers, and failed providers.

The CLI should format date flags as `YYYYMMDD` because Claude Code documents that format and Codex accepts it.

The CLI should ignore provider entries it does not know how to collect. Future CLI versions can add local provider adapters, and future server versions can add providers through the shared schema and required-version gate.

## Provider Absence And Errors

Provider absence is normal:

- A Claude-only user should sync Claude Code rows and skip Codex if Codex has no local data.
- A Codex-only user should sync Codex rows and skip Claude Code if Claude Code has no local data.
- A user with neither provider should get a clean sync result with zero submitted rows and skipped providers.

Existing skippable provider handling should remain provider-specific. Missing Claude Code data and unsupported/missing Codex data should not fail the entire sync when another provider can still submit rows.

Unexpected provider failures should still be reported as failures. If all supported providers fail unexpectedly, sync should continue to throw as it does today.

## Date Semantics

All sync-window dates use UTC because Token Burn leaderboard periods use UTC.

`since` is inclusive. If the server returns `since: "2026-06-06"` and `until: "2026-06-06"`, the CLI should re-read that day. This lets same-day totals grow across scheduled syncs.

Using the server's latest stored `syncedAt` date means the optimization does not depend on local `lastSync`. If local config is deleted and the CLI creates a new client device ID, that device will have no prior rows and the server will return no `since`, causing a full sync for the new device. Existing device merge behavior can recover duplicate devices.

## API Validation And Compatibility

`/api/cli/sync-windows` should validate:

- bearer CLI token is present, valid, unexpired, and unrevoked
- `deviceId` is a UUID
- the device belongs to the authenticated member when it already exists

If the device row does not exist yet, the endpoint can still return provider entries without `since`. The later `/api/sync` call will create the device row with the full device metadata.

Existing CLI versions do not call the endpoint and will continue doing full-history syncs. The existing `/api/sync` high-water behavior still protects totals for old and new CLI clients once deployed.

## Testing

Add focused tests for:

- creating a first daily provider row and model rows
- accepting a higher incoming total and replacing model rows
- accepting an equal incoming total and refreshing model/cost details
- rejecting a lower incoming total while still updating device and CLI token activity
- returning sync windows per provider based on stored `syncedAt`
- omitting `since` for providers with no rows for the device
- rejecting invalid or unauthorized sync-window requests
- adding `--since` and `--until` flags to `ccusage` invocations when the server returns `since`
- doing full-history provider collection when `since` is omitted
- skipping provider absence gracefully while syncing other providers
- ignoring unknown server provider entries in the CLI

## Rollout

Deploy the server high-water change first or alongside the sync-window endpoint. Publish a new required CLI version after the server supports `/api/cli/sync-windows`.

The high-water rule is the correctness fix. The sync-window endpoint and CLI date flags are the performance optimization.
