# Token Burn CLI

Sync local Claude Code and Codex usage totals to a Token Burn leaderboard.

## Install

```bash
npm install -g token-burn-cli
```

This installs the `token-burn` command.

## Login And Sync

```bash
token-burn login --server https://tokenburn.example.com
token-burn sync
token-burn install-scheduler
```

`install-scheduler` installs a user-level scheduler that runs `token-burn sync` every 15 minutes.

## Commands

- `token-burn login --server <url>` authenticates the CLI with a Token Burn server.
- `token-burn sync` sends aggregate usage totals.
- `token-burn status` shows auth and last sync state.
- `token-burn install-scheduler` installs automatic sync.
- `token-burn install-scheduler --dry-run` previews scheduler changes.
- `token-burn uninstall-scheduler` removes automatic sync.
