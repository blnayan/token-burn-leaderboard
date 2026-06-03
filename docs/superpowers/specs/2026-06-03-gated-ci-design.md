# Gated CI Design

## Goal

Make CI faster to interpret and harder to accidentally weaken by separating the fast correctness gate from the heavier packaged CLI and backend E2E checks.

The CI will answer three different questions clearly:

1. Did the code pass unit-level correctness checks?
2. Does the globally installed CLI behave correctly on Linux, macOS, and Windows?
3. Does the production web server ingest real CLI sync data into Postgres correctly?

## Current State

The repository currently has two workflows:

- `CLI Smoke` runs on Linux, macOS, and Windows. Each OS installs dependencies, builds shared code, runs CLI tests, typechecks the CLI, builds the CLI, packs it, installs it globally, and runs a smoke script.
- `Sync E2E` runs on Ubuntu. It starts Postgres, applies migrations, builds the production web server, packs and globally installs the CLI, runs real sync, and asserts exact database state.

This is good coverage, but the signal is blurred. CLI unit failures are discovered inside the cross-platform packaging workflow, and the cross-platform CLI job only proves smoke behavior rather than authenticated sync behavior.

## Recommended CI Shape

Use one gated CI workflow with three main jobs:

1. `unit`
2. `cli-e2e`
3. `sync-e2e`

The `unit` job runs first. The heavier jobs depend on it. If unit checks fail, CI stops before spending time on packaged installs, OS-specific E2E, Postgres, or production server boot.

After `unit` passes, `cli-e2e` and `sync-e2e` run in parallel. The backend E2E does not need to wait for macOS or Windows once the shared fast gate has passed.

## Unit Job

The `unit` job will run on Ubuntu only.

It will perform:

- Dependency install with the locked pnpm version.
- Shared package build.
- Prisma client generation for web tests and typechecks.
- Unit tests for shared, CLI, and web packages.
- Typechecks for shared, CLI, and web packages.
- CLI and web production builds, because build errors are fast enough and must block heavier jobs.

This job is the first required check in branch protection.

## Cross-Platform CLI E2E Job

The `cli-e2e` job will run as a matrix on:

- `ubuntu-latest`
- `macos-latest`
- `windows-latest`

Each matrix entry will:

- Build the shared package and CLI.
- Pack the CLI with `npm pack`.
- Install that tarball globally with `npm install -g`.
- Use an isolated `TOKEN_BURN_CONFIG_DIR`.
- Use deterministic Claude Code and Codex fixture data.
- Run the installed `token-burn` binary, not source files.
- Start a local fake Token Burn HTTP server.
- Seed or write a test CLI token/config in the isolated config directory.
- Run real `token-burn sync` against the fake server.
- Assert the sync request payload exactly, including provider rows, model rows, token categories, costs, source snapshots, platform, device identity inputs, CLI version, and request authentication.
- Run failure checks, including unauthenticated sync and rejected-token sync, and assert that the CLI exits non-zero with useful output.
- Keep existing useful smoke checks: `--version`, `status`, `doctor`, scheduler dry-run, and help text.

This proves the OS-specific CLI behavior without needing Postgres or a production web server on every OS.

## Backend Sync E2E Job

The existing Ubuntu-only backend sync E2E will stay.

It will continue to prove:

- Real Postgres service.
- Real Prisma migrations.
- Production Next standalone server.
- Real login start/poll API flow with DB-approved test session.
- Globally installed packed CLI.
- Real `token-burn sync`.
- Exact database assertions.
- Idempotency.
- Bad-token no-write behavior.
- Local-only safety guards before destructive cleanup.

This remains the source-of-truth backend ingestion test.

## Linux Root Global Install Check

Keep the Linux root global install check as a separate job after `unit`.

Its purpose is different from normal CLI E2E: it verifies that a CLI installed globally as root can be used by a non-root user, and that bundled `ccusage` native binaries remain executable.

This does not need to run on macOS or Windows.

## Workflow Organization

Replace the current split workflows with a single `.github/workflows/ci.yml` so job dependencies are explicit:

```yaml
jobs:
  unit:
    ...

  cli-e2e:
    needs: unit
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    ...

  sync-e2e:
    needs: unit
    ...

  linux-root-global-install:
    needs: unit
    ...
```

The old `cli-smoke.yml` and `sync-e2e.yml` will be removed after equivalent coverage exists in `ci.yml`.

## Test Harness Design

Add a dedicated cross-platform CLI E2E script rather than overloading the current smoke script.

The script will be implemented in Node.js instead of Bash so it works consistently on Linux, macOS, and Windows. Bash can remain for Linux-only root install checks.

The Node harness will:

- Create a temporary config directory.
- Create a temporary fixture directory.
- Start an HTTP server on `127.0.0.1` with an ephemeral port.
- Write deterministic fixture usage files for Claude Code and Codex.
- Write a CLI config with server URL, test token, and stable device ID data.
- Spawn the installed `token-burn` binary.
- Capture stdout, stderr, exit code, and requests received by the fake server.
- Redact tokens in diagnostic output.
- Fail if expected requests are missing or extra unexpected requests are received.

The fake server will implement only the API surface needed by the CLI E2E:

- Accept sync requests from a valid bearer token.
- Reject sync requests with missing or invalid tokens.
- Return realistic success and error bodies.

The backend-specific behavior stays in the existing web E2E script.

## Branch Protection

Required checks will become:

- `unit`
- `cli-e2e (ubuntu-latest)`
- `cli-e2e (macos-latest)`
- `cli-e2e (windows-latest)`
- `sync-e2e`
- `linux-root-global-install`

If GitHub check names differ after implementation, branch protection will use the final job names.

## Out of Scope

This design does not add npm publishing automation.

This design does not add nightly multi-version Node testing.

This design does not add real scheduler installation and uninstallation tests. Scheduler dry-run remains covered by cross-platform CLI E2E. Real scheduler install tests are a follow-up because they need separate OS-specific cleanup and permission handling.

## Success Criteria

CI is considered improved when:

- Unit failures stop heavier E2E jobs.
- Unit job failures are easy to distinguish from packaging or OS failures.
- Linux, macOS, and Windows all run real packaged CLI sync against a local fake server.
- Ubuntu still runs production web plus Postgres sync E2E.
- The Linux root global install check still verifies root install and non-root usage.
- Existing coverage is not lost when old workflows are replaced.
