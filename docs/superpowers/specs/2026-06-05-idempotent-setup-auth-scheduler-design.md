# Idempotent Setup Auth And Scheduler Design

## Goal

Make `token-burn setup` safe and useful to rerun after a user has already completed setup.

Rerunning setup should:

- Reuse existing local authentication only after the server confirms it is still valid.
- Re-run login when local authentication is missing, expired, revoked, deleted from the database, or for a different selected server.
- Run the first sync attempt after authentication is confirmed or refreshed.
- Install or refresh the automatic scheduler without creating duplicate Token Burn scheduler entries.
- Preserve unrelated user scheduler entries.

## Non-Goals

- Do not add interactive prompts.
- Do not add user-configurable schedules.
- Do not change the sync payload contract.
- Do not change provider collection behavior.
- Do not remove or rewrite scheduler entries that are not clearly owned by Token Burn.
- Do not add scheduler status reporting to `token-burn status` or `token-burn doctor` in this change.

## Auth Reuse

`setup` should normalize the requested server URL the same way `login` does.

Before starting browser login, `setup` should read the local config and attempt to reuse existing auth only when:

- Config exists.
- Config has a non-empty token.
- Config `serverUrl` matches the normalized requested setup server URL.

When those conditions hold, `setup` should call a purpose-built authenticated server endpoint:

```text
GET /api/cli/auth
Authorization: Bearer <token>
```

A valid token response should return:

```json
{
  "authenticated": true,
  "member": {
    "displayName": "Jane",
    "username": "jane"
  }
}
```

`username` may be omitted if unavailable. `displayName` must be present.

When the response is valid, `setup` should skip browser login and log:

```text
Existing authentication is valid.
```

When local config is missing, token is missing, or the remembered server differs from the selected server, `setup` should run the existing login flow.

When auth validation returns `401 Unauthorized`, `setup` should treat the local token as invalid and run the existing login flow. This covers expired tokens, revoked tokens, deleted token rows, deleted member rows, and admin/user database cleanup.

When auth validation fails for a non-auth reason, such as server unreachable, malformed response, `5xx`, or another unexpected HTTP error, `setup` should fail before sync or scheduler changes. It should not silently trust the local token.

## Server Endpoint

Add `apps/web/src/app/api/cli/auth/route.ts`.

The route should:

- Read the bearer token from the `Authorization` header.
- Return `401` when the token is missing.
- Hash the token using the existing `hashSecret` helper.
- Look up a `CliToken` where `tokenHash` matches, `revokedAt` is null, and `expiresAt` is in the future.
- Include the related member's `displayName` and `username`.
- Return `401` when no matching valid token exists.
- Return `{ authenticated: true, member: { displayName, username? } }` when valid.

This endpoint should not update `lastUsedAt`. It is a validation probe, not evidence of sync activity.

## Setup Flow

The new setup flow should be:

1. Log `Starting Token Burn setup.`
2. Validate existing auth for the selected server when local config allows it.
3. If validation succeeds, skip login.
4. If validation returns unauthorized or local auth cannot be reused, run login.
5. Log `Login complete.` only after the login flow actually runs.
6. Attempt first sync.
7. If first sync fails, log the failure and continue.
8. Install or refresh the scheduler.
9. If first sync failed but scheduler install succeeded, log that automatic sync was installed/refreshed and will retry on quarter-hour boundaries.
10. Log setup completion with quarter-hour wording.

The final success message should be:

```text
Setup complete. Automatic sync will run on quarter-hour boundaries.
```

If first sync fails but scheduler install succeeds, the retry message should be:

```text
Automatic sync was still installed or refreshed and will retry on quarter-hour boundaries.
```

If scheduler installation fails, keep the existing behavior of throwing a clear setup error that says authentication and first sync were already attempted, and points users to:

```text
npx @blnayan/token-burn@latest install-scheduler
```

## Scheduler Reconciliation

Scheduler installation should be explicitly idempotent for Token Burn-owned artifacts.

### Linux Systemd

When user systemd install succeeds:

- Rewrite `~/.config/systemd/user/token-burn-sync.service`.
- Rewrite `~/.config/systemd/user/token-burn-sync.timer`.
- Run `systemctl --user daemon-reload`.
- Run `systemctl --user enable --now token-burn-sync.timer`.
- Read the user's crontab.
- Remove only the marked Token Burn cron block, if present.
- Write the cleaned crontab back only when a marked Token Burn cron block existed.

This prevents duplicate syncs when a machine previously used cron fallback and later reruns setup in an environment where user systemd is available.

### Linux Cron Fallback

When user systemd is unavailable:

- Read the user's crontab.
- Insert or replace the marked Token Burn cron block.
- Preserve all unrelated crontab lines.

This keeps current idempotent cron behavior.

### macOS Launchd

Keep the existing fixed LaunchAgent label and plist path:

```text
~/Library/LaunchAgents/com.token-burn.sync.plist
```

Reruns should rewrite the plist, unload the old agent if possible, and load the rewritten agent. This refreshes the Token Burn-owned scheduler without creating duplicates.

### Windows Scheduled Task

Keep the existing fixed task name:

```text
TokenBurnSync
```

Reruns should continue using `schtasks /Create ... /F` so the Token Burn-owned task is replaced in place.

## Edge Cases

- **No config:** run login, then sync, then scheduler install.
- **Config without token:** run login and preserve any existing device metadata through the login flow.
- **Different selected server:** run login for the selected server instead of validating a token from another server.
- **Valid token:** skip login, run sync, refresh scheduler.
- **Expired/revoked/deleted token:** validation returns `401`; run login.
- **Deleted member/user cascade:** validation returns `401`; run login.
- **Server unavailable during validation:** fail before sync and scheduler install.
- **Validation response malformed:** fail before sync and scheduler install.
- **First sync fails after valid/revalidated auth:** continue to scheduler install as current setup does.
- **Scheduler install fails:** fail setup with the existing retry guidance.
- **Systemd succeeds after previous cron fallback:** remove the marked Token Burn cron block so only systemd remains.
- **Systemd fails after previous systemd install:** cron fallback is installed/refreshed; existing systemd files may remain, but the timer was not enabled successfully in that run. Uninstall remains responsible for removing both Linux scheduler forms.
- **Existing unrelated cron entries:** preserve them.
- **Existing unmarked user-created Token Burn-like cron entries:** preserve them because they are not clearly Token Burn-owned by marker comments.

## Testing

Add focused tests for:

- `/api/cli/auth` returns `401` without a bearer token.
- `/api/cli/auth` returns `401` for missing, expired, revoked, or deleted tokens.
- `/api/cli/auth` returns authenticated member data for a valid token.
- `setup` skips login when local auth validates.
- `setup` runs login when config is missing, token missing, server differs, or validation returns unauthorized.
- `setup` fails before sync and scheduler install when auth validation has a non-auth failure.
- `setup` keeps attempting scheduler install when first sync fails after auth is valid.
- setup success and retry messages use quarter-hour wording.
- Linux systemd install removes an existing marked Token Burn cron fallback block.
- Linux systemd install does not rewrite crontab when no Token Burn cron fallback block exists.
- Linux cron fallback still replaces an existing marked Token Burn cron block without duplication.
- macOS and Windows install tests still prove fixed-name refresh behavior.

Run at minimum:

```text
pnpm --filter @blnayan/token-burn test -- src/commands/setup.test.ts src/scheduler.test.ts
pnpm --filter @token-burn/web test -- src/app/api/cli/auth/route.test.ts
pnpm --filter @blnayan/token-burn typecheck
pnpm --filter @token-burn/web typecheck
```

