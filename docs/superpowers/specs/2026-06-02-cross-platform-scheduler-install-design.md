# Cross-Platform Scheduler Install Design

## Goal

Make `token-burn install-scheduler` and `token-burn uninstall-scheduler` perform real user-level scheduler changes on Linux, macOS, and Windows, while preserving `--dry-run` as a safe preview mode.

The scheduler runs `token-burn sync` every 15 minutes. It must not require root or administrator privileges in the normal path.

## Non-Goals

- No system-wide service installation.
- No interactive authentication during scheduled runs.
- No dependency installation from scheduled jobs.
- No guaranteed scheduler install on locked-down corporate machines; failures must be explicit and actionable.

## Platform Behavior

### Linux

Prefer a `systemd --user` timer when `systemctl --user` is available and usable.

Install writes:

- `~/.config/systemd/user/token-burn-sync.service`
- `~/.config/systemd/user/token-burn-sync.timer`

Then it runs:

- `systemctl --user daemon-reload`
- `systemctl --user enable --now token-burn-sync.timer`

If user systemd is unavailable, fall back to user crontab. The cron entry is wrapped in stable marker comments so repeated installs replace the existing Token Burn entry instead of duplicating it.

### macOS

Install writes `~/Library/LaunchAgents/com.token-burn.sync.plist`, then runs:

- `launchctl unload <plist>` with failure ignored for not-yet-loaded agents
- `launchctl load <plist>`

The plist uses `StartInterval` 900 and writes stdout/stderr to the Token Burn log file.

### Windows

Install runs `schtasks /Create` for a current-user task named `TokenBurnSync` with:

- `/SC MINUTE`
- `/MO 15`
- `/F`

Uninstall runs `schtasks /Delete /TN TokenBurnSync /F`.

## Command Resolution

The scheduled command uses the current Node executable and CLI entrypoint when available:

```text
<process.execPath> <process.argv[1]> sync
```

If the entrypoint is unavailable, it falls back to:

```text
token-burn sync
```

Arguments are escaped for each platform before writing scheduler files or shell commands.

## Logging

Scheduled runs append stdout and stderr to a platform-appropriate log path:

- Linux/macOS: `/tmp/token-burn-sync.log`
- Windows: scheduler history is handled by Windows Task Scheduler; the sync command still records `lastSync` in local Token Burn config.

Manual sync failures continue to print directly. Scheduled failures record local `lastSync` failure metadata for `token-burn status`.

## CLI UX

`token-burn install-scheduler` performs the install and prints what was installed.

`token-burn install-scheduler --dry-run` prints the scheduler artifact or command without changing the machine.

`token-burn uninstall-scheduler` removes the installed user-level scheduler and prints what was removed.

If an install path fails, the command prints the platform-specific error and exits non-zero. On Linux, systemd failure due to unavailability falls back to cron before failing.

## Test Plan

- Unit-test scheduler file/command builders for Linux systemd, Linux cron, macOS launchd, and Windows schtasks.
- Unit-test install orchestration with injected filesystem and process execution helpers.
- Verify Linux systemd fallback to cron when user systemd is unavailable.
- Verify repeated cron installs replace the marked block rather than duplicate it.
- Verify uninstall removes platform-specific scheduler artifacts.
- Run full CLI tests, root typecheck, lint, build, and Docker build after implementation.
