# CLI Install And Release

## User Setup

Token Burn CLI requires Node.js 24 LTS or newer.

```bash
npx @blnayan/token-burn@latest setup
```

This no-install setup command downloads the latest published CLI, prints a browser approval URL, waits for login approval, runs the first sync, and installs automatic sync.

The scheduler installed by `setup` runs the latest published CLI each time:

```bash
npm exec --yes --package @blnayan/token-burn@latest -- token-burn sync
```

The npm package is `@blnayan/token-burn`. You do not need a global `token-burn` install for normal usage.

You can still install the CLI globally if you prefer:

```bash
npm install -g @blnayan/token-burn
token-burn setup
```

The default server is `https://tokenburn.nayanbhut.dev`. Use `npx @blnayan/token-burn@latest setup --server-url <url>` only for a different deployment.

The CLI uses `tokscale` to read local/session coding-agent usage. Providers that require a separate login, sync, or cache-refresh flow, such as Cursor, are intentionally excluded for now.

## Device Identity And Recovery

Token Burn stores a random per-install device ID in `~/.config/token-burn/config.json`.
Normal npm uninstall/reinstall keeps this config file, so the same device identity is reused.

If the config file is deleted, the next sync creates a new device. To recover duplicated history:

```bash
npx @blnayan/token-burn@latest setup
npx @blnayan/token-burn@latest devices
npx @blnayan/token-burn@latest devices merge <old-device-id> <new-device-id>
```

Do not edit the database manually unless you are repairing a server-side incident.

## Local Smoke Test

```bash
pnpm --filter @blnayan/token-burn build
pnpm --filter @blnayan/token-burn pack:dry-run
```

The dry-run tarball must include `dist/index.js`, `README.md`, and `package.json`.

## Manual First Publish

These steps require the npm account that will own the package.

```bash
npm login
cd packages/cli
npm publish --access public
```

If npm asks for a two-factor authentication code, enter the current code from your authenticator.

After publish, verify install from a clean machine or temporary directory:

```bash
npm install -g @blnayan/token-burn
token-burn --version
token-burn status
```

## Future Releases

1. Update `packages/cli/package.json`, `packages/cli/src/version.ts`, and `apps/web/src/app/api/cli/health/route.ts` versions.
2. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
3. Run `pnpm --filter @blnayan/token-burn pack:dry-run`.
4. Publish from `packages/cli` with `npm publish --access public`.
