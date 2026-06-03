# CLI Install And Release

## User Install

```bash
npm install -g @blnayan/token-burn
token-burn login
token-burn sync
token-burn install-scheduler
```

The npm package is `@blnayan/token-burn`. The installed command is `token-burn`.

The default server is `https://tokenburn.nayanbhut.dev`. Use `token-burn login --server-url <url>` only for a different deployment.

If a global npm install reports that the `ccusage` native binary is not executable, do not run `token-burn sync` with `sudo`. Reinstall Node/npm in a user-writable environment such as `nvm`, or fix the native binary execute bit once.

## Device Identity And Recovery

Token Burn stores a random per-install device ID in `~/.config/token-burn/config.json`.
Normal npm uninstall/reinstall keeps this config file, so the same device identity is reused.

If the config file is deleted, the next sync creates a new device. To recover duplicated history:

```bash
token-burn login
token-burn sync
token-burn devices
token-burn devices merge <old-device-id> <new-device-id>
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
