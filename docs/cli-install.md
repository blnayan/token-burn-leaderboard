# CLI Install And Release

## User Install

```bash
npm install -g token-burn-cli
token-burn login --server https://tokenburn.example.com
token-burn sync
token-burn install-scheduler
```

The npm package is `token-burn-cli`. The installed command is `token-burn`.

Use a real production server URL instead of `https://tokenburn.example.com`.

## Local Smoke Test

```bash
pnpm --filter token-burn-cli build
pnpm --filter token-burn-cli pack:dry-run
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
npm install -g token-burn-cli
token-burn --version
token-burn status
```

## Future Releases

1. Update `packages/cli/package.json` version.
2. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`.
3. Run `pnpm --filter token-burn-cli pack:dry-run`.
4. Publish from `packages/cli` with `npm publish --access public`.
