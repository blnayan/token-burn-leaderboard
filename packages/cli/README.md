# Token Burn CLI

Sync local Claude Code and Codex usage totals to a Token Burn leaderboard.

## Install

Requires Node.js 22.12.0 or newer.

```bash
npm install -g @blnayan/token-burn
```

This installs the `token-burn` command.

## Login And Sync

```bash
token-burn login
token-burn sync
token-burn install-scheduler
```

`install-scheduler` installs a user-level scheduler that runs `token-burn sync` every 15 minutes.

## Commands

- `token-burn login` authenticates the CLI with `https://tokenburn.nayanbhut.dev`.
- `token-burn login --server-url <url>` authenticates with another Token Burn server.
- `token-burn sync` sends aggregate usage totals.
- `token-burn status` shows auth and last sync state.
- `token-burn install-scheduler` installs automatic sync.
- `token-burn install-scheduler --dry-run` previews scheduler changes.
- `token-burn uninstall-scheduler` removes automatic sync.

## Privacy

Token Burn syncs aggregate daily usage only.

Stored by Token Burn:

- Daily aggregate token totals
- Provider name
- Model names when `ccusage` reports them
- Token categories such as input, output, cache creation, and cache read
- Reasoning output token details when reported
- Cost estimates when `ccusage` reports them
- Device name, OS, CLI version, `ccusage` version, and sync timestamp

Not stored by Token Burn:

- Prompts
- Raw conversation text
- Project paths or file paths
- Session IDs
- Raw `ccusage` rows
- GitHub OAuth tokens
- Raw CLI tokens

Leaderboard periods use UTC boundaries. "Today" means the current UTC date.

If `sync` reports that the `ccusage` native binary is not executable after a global npm install, do not run `token-burn sync` with `sudo`; root has a separate Token Burn config. Reinstall Node/npm in a user-writable environment such as `nvm`, or fix the native binary execute bit once.
