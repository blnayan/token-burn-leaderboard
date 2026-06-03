# Pre-Launch Hardening Design

## Summary

Token Burn should be safer and clearer before more users install it. The current MVP can sync usage, recover duplicate devices, and show leaderboard totals, but a few launch-edge cases still need product-level handling: optional `ccusage` detail drift, unclear local health state, duplicate-device recovery guidance, and explicit privacy documentation.

This design keeps the app's existing aggregate-only model. It does not add database backups, hardware fingerprinting, automatic merges, or an admin dashboard.

## Goals

- Keep provider-level sync working when optional `ccusage` model details are malformed or drift in shape.
- Make `token-burn status` and `token-burn doctor` explain the local setup clearly enough for normal users to self-diagnose.
- Let the CLI warn about likely duplicate devices and explain blocked merge conflicts.
- Publish a clear privacy and UTC note in user-facing docs.
- Preserve the current random per-install device UUID model.
- Preserve the current aggregate-only sync boundary.

## Non-Goals

- No backup design or backup automation in this pass.
- No hardware-derived device IDs.
- No silent or automatic duplicate-device merges.
- No admin web UI for repair operations.
- No provider support beyond Claude Code and Codex.
- No independent pricing or token recalculation engine.

## Current Context

The CLI reads local `ccusage` daily reports for Claude Code and Codex, normalizes aggregate daily totals, and posts them to `/api/sync`. The server stores one `DailyProviderUsage` row per internal device, provider, and UTC date. Optional `DailyModelUsage` rows preserve per-model aggregate detail when available.

The CLI uses a random UUID stored in `~/.config/token-burn/config.json` as `deviceId`. Re-login now preserves this ID. If the config file is deleted, the next sync creates a new device. The recently added `token-burn devices` and `token-burn devices merge <source> <target>` commands provide an explicit recovery path.

## Design

### 1. ccusage Optional Detail Resilience

Provider-level daily rows are the leaderboard source of truth. Optional model details should enrich stored data, but they should not be allowed to block a valid provider total.

The CLI should treat malformed `models` or `modelBreakdowns` as non-fatal:

- If provider-level `date`, token category fields, and `totalTokens` are valid, the row remains syncable.
- If optional model breakdown parsing fails, the normalized row omits `models`.
- Costs, token details, and source snapshots that are valid at the provider level remain preserved.
- Provider-level failures still fail the provider. Invalid dates, invalid numeric token totals, invalid cost values, or impossible totals should not be uploaded.

This behavior should apply to both Claude Code and Codex because both providers can expose optional model data.

### 2. CLI Health Visibility

Users need one command that answers: am I authenticated, what server am I using, what device identity is this install using, did sync last work, and should I upgrade?

`token-burn status` should print:

- CLI version.
- Authenticated server or remembered server.
- Device name and saved device ID when present.
- Last sync result, timestamp, and message when present.
- An upgrade hint when the server reports a newer recommended CLI version.
- A login hint when the local config is missing or has no token.

`token-burn doctor` should print:

- The same CLI version and authentication summary.
- Platform.
- Device name and device ID when present.
- Last sync result when present.
- The current instruction to run `token-burn sync`.
- Duplicate-device warnings when authenticated and the server reports likely duplicate devices.

The CLI should not make status/doctor unusable when the health check fails. If the server is unreachable, these commands should print local state and a short health-check warning.

### 3. Server Health Endpoint

Add a lightweight CLI health endpoint:

```text
GET /api/cli/health
```

Response:

```json
{
  "recommendedCliVersion": "0.1.5",
  "minimumCliVersion": "0.1.5",
  "serverTime": "2026-06-03T00:00:00.000Z"
}
```

The endpoint is public because it exposes no member data or secrets. It exists only to help installed CLIs show upgrade guidance and verify server reachability.

The CLI should compare semantic versions using the local package version and the server's `recommendedCliVersion`. If the local version is lower, it should print:

```text
Update available: token-burn <local> -> <recommended>. Run npm install -g @blnayan/token-burn@latest.
```

### 4. Device Recovery UX Polish

The existing device merge flow should remain explicit. Improvements are messaging and discoverability:

- `token-burn devices` should clearly separate normal devices from likely duplicate groups.
- Duplicate groups with zero conflicts should include a copyable merge suggestion.
- Duplicate groups with conflicts should say that automatic merge is blocked because the same provider/date has different totals.
- `token-burn devices merge` should surface server conflicts with provider, date, source total, and target total.
- `token-burn doctor` should warn when duplicate groups are present and tell users to run `token-burn devices`.

The server should continue refusing conflicting merges. There is no force flag in this design.

### 5. Privacy And UTC Documentation

User-facing docs should state what leaves the machine.

Stored by Token Burn:

- Daily aggregate token totals.
- Provider name.
- Model names when `ccusage` reports them.
- Token categories such as input, output, cache creation, and cache read.
- Non-scoring token details such as reasoning output when reported.
- Cost estimates when `ccusage` reports them.
- Device name, OS, CLI version, `ccusage` version, and sync timestamp.

Not stored by Token Burn:

- Prompts.
- Raw conversation text.
- Project paths or file paths.
- Session IDs.
- Raw `ccusage` rows.
- GitHub OAuth tokens.
- Raw CLI tokens.

Docs should also state that leaderboard periods are based on UTC boundaries. "Today" means the current UTC date.

## Error Handling

- Invalid sync payloads remain rejected by `/api/sync`.
- Optional model parsing errors are contained inside CLI normalization and do not block provider rows.
- Health endpoint failures are non-fatal for status/doctor commands.
- Device merge conflicts remain a server-side `409 Conflict` with structured conflict details.
- CLI commands should translate common auth failures into "run `token-burn login`" guidance.

## Testing Strategy

- Add CLI normalization tests proving malformed optional model details do not drop provider totals.
- Add status tests for CLI version, device identity, last sync, and upgrade hints.
- Add doctor tests for local setup output and duplicate-device warning output.
- Add devices command tests for conflict messaging.
- Add a web test or typecheck coverage for the health route response shape.
- Run focused CLI tests, web typecheck, CLI typecheck, and CLI build before release.

## Release Notes

This work should be released as a CLI patch version and a web deploy. Users need both for full functionality:

- The web deploy provides `/api/cli/health` and current device APIs.
- The CLI publish provides improved status, doctor, device conflict messaging, and ccusage resilience.

The release should recommend users install the newest CLI:

```bash
npm install -g @blnayan/token-burn@latest
```
