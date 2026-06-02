# Token Burn VPS Deployment

Token Burn runs behind the host-level Caddy reverse proxy. Docker Compose runs Postgres and the Next.js web app.

## Setup

1. Copy `.env.example` to `.env.prod`.
2. Fill in GitHub OAuth values, `AUTH_SECRET`, `ADMIN_GITHUB_LOGIN`, and Postgres credentials. Token Burn normalizes leaderboard periods and CLI usage grouping to UTC. Generate `AUTH_SECRET` with `openssl rand -base64 32`.
3. Run `pnpm audit --prod` and review any unresolved advisories before deploying.
4. Run `docker compose --env-file .env.prod config` and confirm no placeholder values from `.env.example` remain.
5. Run `docker compose --env-file .env.prod build`.
6. Run `docker compose --env-file .env.prod up -d postgres`.
7. Run `docker compose --env-file .env.prod --profile tools run --rm migrate`.
8. Run `docker compose --env-file .env.prod up -d web`.
9. Point Caddy at `127.0.0.1:3000`.
10. Run `PLAYWRIGHT_BASE_URL=https://tokenburn.example.com pnpm --filter @token-burn/web test:e2e` to smoke-test the public leaderboard.
11. Create an invite, accept it through GitHub, approve CLI login, run `token-burn sync`, and confirm the leaderboard updates.

## Caddy Route

```caddyfile
tokenburn.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## Database Backup

```bash
docker compose --env-file .env.prod exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > tokenburn-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Run this backup at least daily through cron or a systemd timer, copy backups off the VPS, and keep enough retention to recover from a bad deploy or accidental deletion.

## Restore

```bash
cat backup.sql | docker compose --env-file .env.prod exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

Test restore on a non-production database before relying on the backup process.
