# Token Burn CLI

Sync local Claude Code and Codex usage totals to a Token Burn leaderboard.

## Quick Start

Requires Node.js 24 LTS or newer.

```bash
npx @blnayan/token-burn@latest setup
```

`setup` prints a login approval URL, waits for approval, runs the first sync, and installs automatic sync.

You can still install the CLI globally if you prefer:

```bash
npm install -g @blnayan/token-burn
token-burn setup
```

## Commands

- `token-burn setup` authenticates, syncs once, and installs automatic sync.
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
