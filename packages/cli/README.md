# Token Burn CLI

Sync local coding-agent usage totals reported by tokscale to a Token Burn leaderboard.

The CLI supports tokscale local/session providers such as Claude Code, Codex, OpenCode, Gemini CLI, Grok Build, and Antigravity CLI. Providers that require a separate login, sync, or cache-refresh flow, such as Cursor, are intentionally excluded for now.

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

Command names are shown as `token-burn`; use `npx @blnayan/token-burn@latest <command>` for no-install usage, or run them after a global install.

- `token-burn setup` authenticates, syncs once, and installs automatic sync.
- `token-burn login` authenticates the CLI with `https://tokenburn.nayanbhut.dev`.
- `token-burn login --server-url <url>` authenticates with another Token Burn server.
- `token-burn sync` sends aggregate usage totals.
- `token-burn status` shows auth and last sync state.
- `token-burn scheduler install` installs automatic sync.
- `token-burn scheduler install --dry-run` previews scheduler changes.
- `token-burn scheduler uninstall` removes automatic sync.
- `token-burn install-scheduler` and `token-burn uninstall-scheduler` remain available as compatibility aliases.

## Output Modes

- Interactive terminals use rich Clean Operator output by default.
- Non-TTY output, cron, CI, and `NO_COLOR` use plain output.
- Use `--plain` for log-safe human text.
- Use `--json` for machine-readable output where supported.
- Use `--no-color` to keep rich layout without ANSI color.

## Privacy

Token Burn syncs aggregate daily usage only.

Stored by Token Burn:

- Daily aggregate token totals
- Provider name
- Model names when `tokscale` reports them
- Token categories such as input, output, cache creation, and cache read
- Reasoning output token details when reported
- Cost estimates when `tokscale` reports them
- Device name, OS, CLI version, source usage collector version, and sync timestamp

Not stored by Token Burn:

- Prompts
- Raw conversation text
- Project paths or file paths
- Session IDs
- Raw `tokscale` rows
- GitHub OAuth tokens
- Raw CLI tokens

Leaderboard periods use UTC boundaries. "Today" means the current UTC date.
