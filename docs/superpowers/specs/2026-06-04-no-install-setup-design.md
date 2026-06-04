# No-Install Setup Design

## Goal

Make Token Burn onboarding a single no-install command:

```bash
npx @blnayan/token-burn@latest setup
```

The setup command authenticates the user, runs an initial sync, and installs automatic sync. The scheduler installed by setup must always run the latest published CLI instead of pinning itself to the CLI entrypoint that happened to install the scheduler.

## User Experience

The primary user-facing flow is:

```bash
npx @blnayan/token-burn@latest setup
```

The command prints the login approval URL and waits for approval. It does not try to open a browser automatically.

After login approval, setup runs an immediate sync, then installs or refreshes the scheduler. The final output should make the result clear:

- Login completed.
- First sync completed, skipped unavailable providers, or failed.
- Automatic sync installed or needs a retry.

The existing commands remain available for troubleshooting and advanced use:

```bash
token-burn login
token-burn sync
token-burn status
token-burn devices
token-burn install-scheduler
token-burn uninstall-scheduler
```

Documentation should lead with `npx @blnayan/token-burn@latest setup`, then list the existing commands as optional tools.

## CLI Command

Add a public `setup` command to the CLI.

`setup` should accept the same server selection options as `login`:

```bash
token-burn setup --server-url https://tokenburn.example.com
token-burn setup --server https://tokenburn.example.com
```

Default server remains `https://tokenburn.nayanbhut.dev`.

Setup sequence:

1. Run login using the selected server URL.
2. Preserve any existing local `deviceId` and `deviceName`, matching current login behavior.
3. Run `sync`.
4. Run `install-scheduler`.
5. Print concise completion output.

## Scheduler Command

`install-scheduler` should install a latest-resolving npm command for scheduled syncs, not the currently running CLI entrypoint.

On macOS and Linux:

```bash
npm exec --yes --package @blnayan/token-burn@latest -- token-burn sync
```

On Windows:

```text
npm.cmd exec --yes --package @blnayan/token-burn@latest -- token-burn sync
```

This avoids global package mutation while ensuring scheduled syncs use the latest published CLI.

The scheduler output builders should continue to generate platform-native artifacts:

- Linux systemd user service and cron fallback.
- macOS launchd plist.
- Windows scheduled task.

Only the command argv changes.

## Error Handling

If login fails, setup stops. Without authentication there is no useful sync or scheduler install.

If sync fails after successful login, setup should still attempt scheduler installation. The output should say that login completed, the first sync failed, and automatic sync was installed or attempted. This handles users who have no current usage rows or have a temporarily broken provider.

If scheduler installation fails, setup exits nonzero and explains that login and first sync were already attempted, but automatic sync was not installed. The retry command should be:

```bash
npx @blnayan/token-burn@latest install-scheduler
```

Existing `sync` required-version enforcement remains the hard compatibility safety net.

## Testing

Add unit tests for:

- `setup` runs login, sync, and scheduler install in order.
- `setup --server-url` passes the selected server to login.
- `setup` stops when login fails.
- `setup` attempts scheduler install when sync fails after login.
- `setup` reports scheduler install failure clearly.
- default scheduler argv uses npm latest on Linux/macOS.
- default scheduler argv uses `npm.cmd` on Windows.
- scheduler dry-run output contains the npm latest command.

Update existing scheduler tests that currently expect the installed entrypoint path.

Run existing CLI and web tests after implementation.

## Documentation

Update:

- `README.md`
- `packages/cli/README.md`
- `docs/cli-install.md`

The main install section should no longer require a global install. It should recommend:

```bash
npx @blnayan/token-burn@latest setup
```

Manual `npm install -g @blnayan/token-burn` remains a supported alternative, not the primary path.

## Non-Goals

This design does not remove existing commands.

This design does not auto-update global npm installations.

This design does not automatically open a browser during login.

This design does not add standalone native binaries. Users still need Node.js and npm.

