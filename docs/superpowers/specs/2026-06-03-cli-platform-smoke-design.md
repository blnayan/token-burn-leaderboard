# CLI Platform Smoke Design

## Goal

Prove the packed Token Burn CLI behaves consistently on Linux, macOS, and Windows before release, including platform-specific scheduler dry-run output and basic command behavior.

## Scope

This spec extends CI smoke coverage only. It does not install real schedulers on hosted runners, perform authenticated syncs, or contact the production server.

## Design

Add a reusable Bash smoke script that runs against an already installed packed `token-burn` binary. GitHub Actions already provides Bash on Ubuntu, macOS, and Windows, so one script can drive all three runners while still asserting OS-specific output.

The cross-platform smoke script will verify:

- `token-burn --version` prints a version.
- `token-burn status` works without config and reports unauthenticated local state.
- `token-burn doctor` works without config and prints local setup guidance.
- `token-burn install-scheduler --dry-run` emits native scheduler content for the current OS.
- `token-burn uninstall-scheduler --help` and `token-burn devices --help` are available.
- `token-burn sync` with an isolated empty config directory fails nonzero with login guidance.

Scheduler dry-run assertions are platform-specific:

- Linux must include `token-burn-sync.service`, `token-burn-sync.timer`, and `# Cron fallback`.
- macOS must include `com.token-burn.sync`, `StartInterval`, and `900`.
- Windows must include `schtasks`, `/TN TokenBurnSync`, `/SC MINUTE`, and `/MO 15`.

Keep the existing Linux Docker root/global install smoke test. That test proves the `sudo npm install -g` shape by installing as root, running the CLI as a non-root user, and checking the bundled `ccusage` binary is executable.

## CI Flow

The `CLI Smoke` workflow will continue to use a matrix over `ubuntu-latest`, `macos-latest`, and `windows-latest`. Each matrix job will:

1. Install dependencies.
2. Build `@token-burn/shared` so CLI typecheck can resolve workspace package declarations.
3. Run CLI tests, typecheck, and build.
4. Pack the CLI.
5. Install the packed CLI globally.
6. Run the cross-platform smoke script.

The Linux root global install job remains separate because it requires Docker and non-root user checks.

## Error Handling

The smoke script should exit nonzero on any failed assertion and print the relevant command output before failing. The unauthenticated sync test should explicitly expect failure; if `token-burn sync` succeeds with an empty config, the script must fail.

## Out Of Scope

- Real `systemctl`, `launchctl`, or `schtasks` mutations on hosted runners.
- Authenticated sync against production or staging.
- Full end-to-end `ccusage` data discovery on real user machines.
