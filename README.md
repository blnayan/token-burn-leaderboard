# Token Burn

Token Burn is a private-invite leaderboard for aggregate Claude Code and Codex usage. The web app shows member totals, and the `token-burn` CLI syncs local daily usage totals from each member's machine.

Production: <https://tokenburn.nayanbhut.dev>

## Quick Start

Requires Node.js 24 LTS or newer.

```bash
npx @blnayan/token-burn@latest setup
```

`setup` prints a browser approval URL, waits for login approval, runs the first sync, and installs automatic sync. You must have accepted a Token Burn invite before the CLI can connect.

Useful follow-up commands:

```bash
npx @blnayan/token-burn@latest status
npx @blnayan/token-burn@latest devices
npx @blnayan/token-burn@latest devices merge <old-device-id> <new-device-id>
npx @blnayan/token-burn@latest scheduler uninstall
```

The installed scheduler runs the latest published CLI each time, so a global install is not required. For CLI details, see [packages/cli/README.md](packages/cli/README.md).

## Privacy

Token Burn syncs aggregate daily usage only.

Stored:

- Daily token totals by provider and model
- Token categories such as input, output, cache creation, and cache read
- Cost estimates and reasoning token details when reported
- Device name, OS, CLI version, `ccusage` version, and sync timestamp

Not stored:

- Prompts or raw conversation text
- Project paths or file paths
- Session IDs
- Raw `ccusage` rows
- GitHub OAuth tokens or raw CLI tokens

Leaderboard periods use UTC boundaries.

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

Required web environment variables are listed in [.env.example](.env.example). For the public dev Docker stack, create `.env.dev` from that example and run:

```bash
pnpm dev:public
```

## Repository Layout

```text
apps/web/         Next.js app, API routes, Prisma schema, shadcn UI
packages/cli/     npm CLI package published as @blnayan/token-burn
packages/shared/  shared schemas and formatting utilities
docs/             deployment notes and implementation specs
scripts/          release and cross-platform test helpers
```

## Deployment

Production runs the web app and Postgres through Docker Compose behind a host-level reverse proxy.

```bash
pnpm prod:config
pnpm prod:build
pnpm prod:migrate
pnpm prod:up
```

See [docs/deploy-vps.md](docs/deploy-vps.md) for VPS setup, Caddy routing, backup, and restore notes.

## CLI Releases

The CLI package is `@blnayan/token-burn`.

```bash
pnpm --filter @blnayan/token-burn prepublishOnly
cd packages/cli
npm publish
```

After publishing a new required CLI version, rebuild and redeploy the web app so `/api/cli/health` reports the new version.

## CI

GitHub Actions runs unit tests, typecheck, web and CLI builds, packaged CLI E2E on Linux/macOS/Windows, a Linux root global-install smoke test, and setup/sync E2E against Postgres.
