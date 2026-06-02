FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --filter @token-burn/shared build
RUN DATABASE_URL=postgresql://tokenburn:tokenburn@postgres:5432/tokenburn pnpm --filter @token-burn/web db:generate
RUN ADMIN_GITHUB_LOGIN=build-admin AUTH_GITHUB_ID=build-github-id AUTH_GITHUB_SECRET=build-github-secret AUTH_SECRET=build-auth-secret AUTH_URL=https://tokenburn.example.com DATABASE_URL=postgresql://tokenburn:tokenburn@postgres:5432/tokenburn TOKEN_BURN_PUBLIC_URL=https://tokenburn.example.com pnpm --filter @token-burn/web build

FROM deps AS migrator
COPY . .
RUN pnpm --filter @token-burn/shared build
RUN DATABASE_URL=postgresql://tokenburn:tokenburn@postgres:5432/tokenburn pnpm --filter @token-burn/web db:generate
CMD ["pnpm", "--filter", "@token-burn/web", "db:deploy"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
