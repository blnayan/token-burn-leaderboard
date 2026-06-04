# Token Burn

Token Burn is a leaderboard for aggregate Claude Code and Codex token usage. The web app shows invited members on a public leaderboard, and the `token-burn` CLI syncs local daily usage totals from your machine.

The production server is currently:

```text
https://tokenburn.nayanbhut.dev
```

## Quick Start

You need Node.js 24 LTS or newer.

```bash
npx @blnayan/token-burn@latest setup
```

`setup` prints a browser approval URL, waits for login approval, runs the first sync, and installs automatic sync. You must have accepted a Token Burn invite before the CLI can connect.

The scheduler installed by `setup` runs the latest published CLI each time:

```bash
npm exec --yes --package @blnayan/token-burn@latest -- token-burn sync
```

You do not need a global `token-burn` install for normal usage.

Optional troubleshooting commands:

```bash
npx @blnayan/token-burn@latest status
npx @blnayan/token-burn@latest devices
npx @blnayan/token-burn@latest devices merge <old-device-id> <new-device-id>
npx @blnayan/token-burn@latest uninstall-scheduler
```

For more CLI details, see [packages/cli/README.md](packages/cli/README.md) and [docs/cli-install.md](docs/cli-install.md).

## What Gets Synced

Token Burn stores aggregate daily usage, not your prompt content.

Stored:

- Daily token totals by provider
- Model names when reported
- Token categories such as input, output, cache creation, and cache read
- Reasoning output token details when reported
- Cost estimates when reported
- Device name, OS, CLI version, `ccusage` version, and sync timestamp

Not stored:

- Prompts or raw conversation text
- Project paths or file paths
- Session IDs
- Raw `ccusage` rows
- GitHub OAuth tokens
- Raw CLI tokens

Leaderboard periods use UTC boundaries.

## Device Recovery

The CLI keeps a random per-install device ID in your local Token Burn config. Normal npm uninstall/reinstall keeps that config, so your device identity should stay the same.

If the config is deleted or a duplicate device appears:

```bash
npx @blnayan/token-burn@latest setup
npx @blnayan/token-burn@latest devices
npx @blnayan/token-burn@latest devices merge <old-device-id> <new-device-id>
```

Merges automatically keep the higher total for overlapping provider/date rows.

## Repository Layout

```text
apps/web/        Next.js web app, API routes, Prisma schema
packages/cli/    npm CLI package
packages/shared/ shared TypeScript utilities
docs/            deployment notes and implementation docs
scripts/         release and cross-platform test helpers
```

## Development

This repo uses pnpm workspaces.

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Environment variables are documented in [.env.example](.env.example). Production deployment uses Docker Compose with `.env.prod`.

Common production commands:

```bash
pnpm prod:config
pnpm prod:build
pnpm prod:migrate
pnpm prod:up
```

See [docs/deploy-vps.md](docs/deploy-vps.md) for VPS deployment and backup notes.

## Releasing The CLI

The npm package is `@blnayan/token-burn`.

Before publishing:

```bash
pnpm --filter @blnayan/token-burn prepublishOnly
```

Publish from the CLI package:

```bash
cd packages/cli
npm publish
```

After publishing a new required CLI version, rebuild and redeploy the web app so `/api/cli/health` reports the new version.

## CI

GitHub Actions runs:

- Unit tests, typecheck, and builds
- Packaged CLI E2E on Linux, macOS, and Windows
- Linux root global-install smoke test
- Sync E2E against the web app and Postgres
