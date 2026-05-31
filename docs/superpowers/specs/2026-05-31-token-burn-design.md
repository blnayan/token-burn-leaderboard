# Token Burn Leaderboard Design

## Summary

Token Burn is a public leaderboard for a private group of invited members. Members install an npm CLI that uses bundled `ccusage` reports for Claude Code and Codex, aggregates local token usage, and syncs totals to a self-hosted server every 15 minutes. The public website shows only rank, custom display name, token total, and period tabs.

The MVP uses an honor-system Aggregate Snapshot model: the CLI submits aggregate daily provider totals, and the server stores/upserts those totals for leaderboard rollups. It does not upload sessions, commands, project names, GitHub usernames, or raw usage history.

## Goals

- Show a public Token Burn leaderboard for daily, weekly, monthly, and all-time periods.
- Let invited members authenticate with GitHub OAuth and set a custom public display name.
- Let members authenticate the CLI through a copy-paste browser login flow.
- Install a cross-platform scheduled sync that runs every 15 minutes.
- Use `ccusage` as the local source for Claude Code and Codex usage.
- Count all token categories reported by `ccusage` toward the leaderboard score.
- Deploy on the existing VPS behind the existing Caddy reverse proxy.

## Non-Goals

- Public registration without an invite.
- Public GitHub usernames, profile links, provider breakdowns, sessions, commands, project names, or detailed history.
- Strong anti-cheat verification beyond payload validation.
- Organization/team-based GitHub membership checks.
- Billing-cycle-based rankings.
- Rich analytics, badges, trends, or rank movement indicators.

## Architecture

The repository will be a monorepo:

- `apps/web`: Next.js web/API application.
- `packages/cli`: TypeScript npm CLI.
- `packages/shared`: shared TypeScript types and Zod schemas.
- Docker Compose deployment files for the web app and Postgres.

Caddy already runs on the VPS and remains the public reverse proxy. Docker Compose runs the Next.js app and Postgres. Caddy forwards the Token Burn domain to the web container or host-exposed app port.

The Next.js app owns:

- Public leaderboard pages.
- GitHub OAuth callbacks.
- Invite acceptance.
- Custom display name setup.
- CLI login approval.
- Admin invite creation.
- Sync ingestion API.
- Leaderboard read API.

The CLI owns:

- Copy-paste login flow.
- Local credential storage.
- `ccusage` execution and JSON parsing.
- Claude Code and Codex daily aggregate normalization.
- Sync payload submission.
- Scheduler installation, removal, status, and health checks.

## Authentication and Membership

Membership is invite-based, with identity verified by GitHub OAuth. The single MVP admin is configured with `ADMIN_GITHUB_LOGIN`. That admin can create invite links from an admin page.

The CLI login flow does not open the browser automatically:

1. User runs `token-burn login`.
2. CLI creates a temporary device login session with the server.
3. CLI prints a one-time login URL and waits.
4. User copies the URL into a browser.
5. Website handles GitHub OAuth, invite/member validation, and CLI approval.
6. CLI polls the server until the login session is approved or expires.
7. Server returns a Token Burn CLI token.
8. CLI stores the token locally.

Future sync requests use `Authorization: Bearer <token-burn-cli-token>`. GitHub OAuth tokens stay server-side and are never sent to or stored by the CLI.

CLI login sessions expire after 10 minutes. Expired or revoked CLI tokens stop sync and tell the user to run `token-burn login` again.

## Data Model

Core entities:

- `users`: GitHub identity, membership state, admin flag derived from config, timestamps.
- `members`: custom display name and public leaderboard identity.
- `invites`: invite code, creator, expiration, redemption state.
- `cli_login_sessions`: temporary login/device sessions used by the CLI login flow.
- `cli_tokens`: hashed CLI tokens, owning member, creation time, last-used time, revocation time.
- `daily_provider_usage`: member, provider, date, token category totals, total token score, sync metadata.

Providers for MVP:

- `claude_code`
- `codex`

The server stores daily provider totals and computes leaderboard periods from those rows. Each sync upserts records by `member + provider + date`, making retries and repeated scheduled syncs idempotent.

All MVP leaderboard periods use UTC boundaries:

- Daily: current UTC date.
- Weekly: current ISO week.
- Monthly: current UTC calendar month.
- All-time: all stored daily provider totals.

The leaderboard score includes all token categories reported by `ccusage`, including input, output, cache creation, cache read, and any other reported token categories that fit the shared schema.

## CLI Behavior

The CLI is distributed as an npm package and depends on `ccusage`, so users install one package:

```bash
npm install -g token-burn
```

Primary commands:

- `token-burn login`: prints a login URL and waits for browser approval.
- `token-burn sync`: runs usage collection and submits aggregate totals.
- `token-burn install-scheduler`: installs the 15-minute background sync.
- `token-burn uninstall-scheduler`: removes the background sync.
- `token-burn status`: shows auth, scheduler, last sync, and provider health.
- `token-burn doctor`: checks local environment, readable usage sources, `ccusage` output, and server connectivity.
- `token-burn logout`: removes local CLI credentials.

Scheduler support:

- macOS: `launchd` user agent.
- Linux: `systemd --user` timer when available, with cron fallback.
- Windows: Task Scheduler through PowerShell.

Scheduled sync never performs dependency installation or interactive auth. If it cannot sync, it records a local error for `token-burn status` and tries again on the next scheduled run.

## Sync Payload

The CLI submits aggregate daily provider snapshots. The payload includes:

- Provider name.
- Usage date.
- Token category totals.
- Total token score.
- CLI version.
- `ccusage` version.
- Operating system.
- Sync timestamp.

The public leaderboard ignores provider and sync metadata. Those fields exist for supportability and future member-only diagnostics.

The server rejects malformed payloads, unknown providers, negative totals, impossible dates, unauthorized tokens, and oversized payloads.

## Public and Member UX

The public homepage is the leaderboard itself, not a marketing landing page. It uses a focused shadcn-style developer-tool design with compact controls, clear typography, and a polished table.

Public leaderboard:

- Product name: Token Burn.
- Period tabs: Daily, Weekly, Monthly, All-time.
- Table columns: Rank, Display Name, Tokens.
- Formatted token totals, for example `12.4M`.
- Empty state when no data exists.
- No public links or GitHub identity.

Member/admin-only pages:

- GitHub login and invite acceptance.
- Display name setup.
- CLI login approval.
- CLI setup/status guidance.
- Admin invite creation.

Use shadcn-style UI primitives where appropriate:

- `Table` for rankings.
- `Tabs` for periods.
- `Button`, `Input`, and form patterns for setup/admin workflows.
- `Dialog` for bounded confirmation or invite creation flows.
- `Card` only for bounded repeated/admin surfaces, not broad page-section decoration.
- Toast feedback for success/error states.

## Error Handling

CLI behavior:

- Missing/unreadable provider data: sync the provider that works, record failed provider health.
- `ccusage` JSON parse failure: fail that provider and do not submit questionable data.
- Network/server failure: manual sync prints the error; scheduled sync retries on the next run.
- Expired/revoked token: stop sync and ask the user to run `token-burn login`.
- Scheduler install failure: print the platform-specific failure and keep manual sync available.

Server behavior:

- Startup validates required environment variables.
- Sync ingestion validates auth and payload shape.
- Duplicate syncs are safe because usage rows are upserted.
- Public leaderboard API returns empty states cleanly.

Deployment behavior:

- Compose restart policies keep the app and database running.
- Caddy owns HTTPS and public routing.
- Deployment docs include database backup and restore guidance.

## Testing

Web/API tests:

- Token summing.
- Period filtering.
- Sync payload validation.
- Invite validation.
- Display-name rules.
- Sync ingestion.
- Public leaderboard reads.
- CLI login polling.
- Invite acceptance.
- Admin-only invite creation.

CLI tests:

- `ccusage` JSON normalization for Claude Code and Codex.
- Token storage abstraction.
- Login polling.
- Sync payload creation.
- Scheduler command generation.
- Dry-run scheduler behavior for macOS, Linux, and Windows.

Acceptance path:

1. Public visitor can view the leaderboard without logging in.
2. Admin can create an invite link.
3. Invited user can sign in with GitHub and set a custom display name.
4. User can run `token-burn login`, copy the printed URL into a browser, approve auth, and receive a local CLI token.
5. User can run `token-burn sync` and see leaderboard totals update.
6. User can install the scheduler and confirm `token-burn status` shows scheduled sync health.
7. Daily, weekly, monthly, and all-time periods rank by all reported token categories.
8. Public pages do not expose GitHub usernames, links, provider breakdowns, sessions, commands, projects, or detailed history.
