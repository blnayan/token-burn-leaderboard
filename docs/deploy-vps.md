# Token Burn VPS Deployment

Token Burn runs behind the host-level Caddy reverse proxy. Docker Compose runs Postgres and the Next.js web app.

## Setup

1. Copy `.env.example` to `.env.prod`.
2. Fill in GitHub OAuth values, `AUTH_SECRET`, `ADMIN_GITHUB_LOGIN`, and Postgres credentials. Token Burn normalizes leaderboard periods and CLI usage grouping to UTC.
3. Run `docker compose --env-file .env.prod build`.
4. Run `docker compose --env-file .env.prod up -d postgres`.
5. Run `docker compose --env-file .env.prod --profile tools run --rm migrate`.
6. Run `docker compose --env-file .env.prod up -d web`.
7. Point Caddy at `127.0.0.1:3000`.
8. Run `PLAYWRIGHT_BASE_URL=https://tokenburn.example.com pnpm --filter @token-burn/web test:e2e` to smoke-test the public leaderboard.

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

## Restore

```bash
cat backup.sql | docker compose --env-file .env.prod exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```
