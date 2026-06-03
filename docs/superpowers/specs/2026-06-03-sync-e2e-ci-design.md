# Sync E2E CI Design

## Goal

Add a CI end-to-end sync test that proves the real packaged CLI can submit usage to the real web API and persist the expected records in Postgres.

This test should close the gap left by unit tests and platform smoke tests. It must catch regressions in the complete sync path:

1. CLI package build and npm tarball install
2. CLI config loading
3. fixture usage discovery and normalization
4. sync payload construction
5. HTTP POST to `/api/sync`
6. bearer token authentication
7. Prisma persistence transaction
8. Postgres uniqueness/idempotency behavior
9. direct database verification

## Non-Goals

- Do not hit production.
- Do not require private Claude Code or Codex data from a developer machine.
- Do not use mocked HTTP, mocked Prisma, or mocked Postgres for this E2E path.
- Do not install real OS schedulers in this E2E job.
- Do not replace the existing unit tests or cross-platform CLI smoke tests.

## Recommended Architecture

Create a new Ubuntu CI job, separate from the cross-platform CLI smoke workflow, that runs a local production-like stack:

- GitHub Actions Postgres service container
- real Prisma schema/migrations applied to that Postgres database
- real Next production build served locally with `next start`
- real CLI npm tarball installed globally
- real `token-burn sync` process
- direct Postgres assertions after sync

The job should use deterministic seeded data instead of bypassing authentication. The seed step should create:

- `User`
- `Member`
- valid `CliToken` with `tokenHash = hashSecret(rawToken)`

The CLI config should be written to an isolated `TOKEN_BURN_CONFIG_DIR` and point to the local Next server URL with the raw test token. This keeps the test faithful to how users actually run the CLI while avoiding developer or production credentials.

## Fixture Usage Input

Add an explicit env-gated fixture mode for E2E only:

- env var: `TOKEN_BURN_E2E_FIXTURE_DIR`
- when unset, production behavior is unchanged
- when set, the CLI reads deterministic fixture files from that directory instead of invoking bundled `ccusage`

This should be implemented at the provider usage boundary, not by bypassing sync. The packaged CLI must still:

- read its real config
- build real `SyncPayload` objects
- validate them through shared schemas
- call the real `/api/sync`
- update `lastSync`

Fixture files should cover both providers:

- `claude_code`
- `codex`

Each fixture should include:

- one provider/date row
- `tokenCategories`
- `tokenDetails`
- `totalTokens`
- `costUsd`
- `costSource`
- `costMetadata`
- `sourceSnapshot`
- at least two model rows

The fixture mode should be intentionally narrow and test-only. It should not be advertised as a user feature.

## E2E Flow

1. Install dependencies with the lockfile.
2. Build shared package.
3. Generate Prisma client.
4. Apply database schema/migrations to CI Postgres.
5. Seed a real member and real CLI token.
6. Build the web app with CI-safe env vars.
7. Start `next start` on `127.0.0.1`.
8. Wait for `/api/cli/health`.
9. Build and pack the CLI tarball.
10. Install the packed CLI globally.
11. Write isolated CLI config containing:
    - local server URL
    - seeded raw token
    - stable `deviceId`
    - stable `deviceName`
12. Write deterministic Claude Code and Codex fixture usage files.
13. Run `token-burn sync`.
14. Query Postgres directly and assert persisted rows.
15. Run `token-burn sync` again.
16. Query Postgres again and assert idempotency.
17. Run a bad-token sync attempt with a separate isolated config.
18. Assert the bad-token attempt fails and does not create rows.

## Database Assertions

The test should verify:

- exactly one `Device` row exists for the seeded member and stable client device ID
- device name, OS, and `lastSeenAt` are populated
- one `DailyProviderUsage` row exists for `claude_code`
- one `DailyProviderUsage` row exists for `codex`
- provider dates match the fixture dates
- total token counts match fixtures
- token categories match fixtures
- token details are persisted
- cost fields are persisted with expected decimal precision
- cost metadata is persisted
- source snapshots are persisted
- CLI version and ccusage version are populated
- all expected `DailyModelUsage` rows exist
- model totals and model cost fields match fixtures
- `CliToken.lastUsedAt` changes from null to a timestamp

The idempotency pass should verify:

- provider row count does not increase on rerun
- model row count does not increase on rerun
- existing rows are updated in place
- `CliToken.lastUsedAt` remains populated

The bad-token pass should verify:

- `token-burn sync` exits non-zero
- output includes an authorization failure
- database row counts remain unchanged

## CI Shape

Add a workflow such as `.github/workflows/sync-e2e.yml`:

- trigger on pull requests and pushes to `main`
- run on `ubuntu-latest`
- use Postgres 16 service
- use Node `22.12.0`
- use pnpm `9.15.0`
- cache pnpm through `actions/setup-node`

Keep this as a separate required check from `CLI Smoke`. The existing smoke workflow should continue to test OS portability on Linux, macOS, and Windows. The E2E workflow should focus on the full sync data path.

## Failure Signals

Failures should be actionable. Scripts should print:

- which server URL was used
- whether health passed
- which provider/date rows were expected
- compact database counts
- CLI stdout/stderr when sync fails

Do not print raw auth tokens.

## Security

- Use an ephemeral raw test token generated in CI.
- Store only the hashed token in Postgres.
- Never log the raw token.
- Use local network only.
- Use a disposable CI database.
- Keep fixture data synthetic.

## Future Extensions

After this local E2E is stable, add optional deeper checks:

- nightly staging sync against a dedicated staging deployment
- Node 24 lane
- release workflow that runs this E2E before npm publish
- actual scheduler create/delete tests in nightly jobs where host mutation is acceptable

## Acceptance Criteria

- A pull request fails if packaged CLI sync cannot write valid rows to Postgres.
- A pull request fails if token auth is bypassed or broken.
- A pull request fails if model rows are not persisted.
- A pull request fails if rerunning sync creates duplicate provider/model rows.
- A pull request fails if bad tokens can write rows.
- The test does not depend on production, developer machines, or private usage data.
