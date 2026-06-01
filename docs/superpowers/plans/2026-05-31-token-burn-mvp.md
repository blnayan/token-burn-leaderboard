# Token Burn MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Token Burn MVP: a public leaderboard backed by invite-only GitHub members and an npm CLI that syncs Claude Code and Codex aggregate usage every 15 minutes.

**Architecture:** Use a pnpm monorepo with `apps/web` for the Next.js web/API app, `packages/cli` for the Node CLI, and `packages/shared` for Zod schemas and shared types. Store data in Postgres through Prisma, deploy `web + postgres` with Docker Compose behind the existing host-level Caddy reverse proxy, and keep public output limited to rank, display name, period, and token total.

**Tech Stack:** TypeScript, pnpm workspaces, Next.js App Router, shadcn/ui, Tailwind CSS, Prisma, Postgres, NextAuth/Auth.js GitHub OAuth, Vitest, Playwright, Commander, keytar with file fallback, bundled `ccusage`, Docker Compose.

---

## File Structure

- Create `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`, and `.npmrc` at the repo root for workspace tooling.
- Create `packages/shared` for schemas and utilities used by both the CLI and web app.
- Create `packages/cli` for the npm CLI, provider adapters, local credential storage, scheduler installers, and CLI tests.
- Create `apps/web` for the Next.js app, API routes, Prisma schema, shadcn components, and web/API tests.
- Create `docker-compose.yml`, `apps/web/Dockerfile`, and `docs/deploy-vps.md` for VPS deployment behind Caddy.

---

### Task 1: Workspace Foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.npmrc`
- Modify: `.gitignore`

- [ ] **Step 1: Write root workspace files**

Create `package.json`:

```json
{
  "name": "token-burn-leaderboard",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm --filter @token-burn/web dev",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "format": "prettier --write ."
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "prettier": "^3.5.3",
    "typescript": "^5.8.3",
    "vitest": "^3.1.4"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
  },
});
```

Create `.npmrc`:

```ini
auto-install-peers=true
strict-peer-dependencies=false
```

Append to `.gitignore` if the entries are missing:

```gitignore
.turbo/
.DS_Store
*.tsbuildinfo
playwright-report/
test-results/
```

- [ ] **Step 2: Install root dependencies**

Run:

```bash
corepack enable
pnpm install
```

Expected: `pnpm-lock.yaml` is created and the install exits with code 0.

- [ ] **Step 3: Verify empty workspace scripts**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: pnpm reports no matching package scripts for workspace children or exits successfully once child packages exist. If it fails only because packages are not created yet, continue to Task 2.

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .npmrc .gitignore pnpm-lock.yaml
git commit -m "chore: set up pnpm workspace"
```

Expected: commit succeeds.

---

### Task 2: Shared Schemas and Utilities

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/tokens.ts`
- Test: `packages/shared/src/tokens.test.ts`
- Test: `packages/shared/src/schemas.test.ts`

- [ ] **Step 1: Create package metadata**

Create `packages/shared/package.json`:

```json
{
  "name": "@token-burn/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "vitest": "^3.1.4"
  }
}
```

Create `packages/shared/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write failing token utility tests**

Create `packages/shared/src/tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatTokens, sumTokenCategories } from "./tokens";

describe("sumTokenCategories", () => {
  it("counts every token category in the score", () => {
    expect(
      sumTokenCategories({
        input: 100,
        output: 50,
        cacheCreate: 25,
        cacheRead: 10,
        other: 5,
      }),
    ).toBe(190);
  });

  it("rejects negative token values", () => {
    expect(() => sumTokenCategories({ input: -1 })).toThrow("Token totals cannot be negative");
  });
});

describe("formatTokens", () => {
  it("formats leaderboard-scale numbers", () => {
    expect(formatTokens(12400)).toBe("12.4K");
    expect(formatTokens(12400000)).toBe("12.4M");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm --filter @token-burn/shared test -- tokens.test.ts
```

Expected: FAIL because `./tokens` does not exist.

- [ ] **Step 4: Implement token utilities**

Create `packages/shared/src/tokens.ts`:

```ts
export type TokenCategories = Record<string, number>;

export function sumTokenCategories(categories: TokenCategories): number {
  return Object.values(categories).reduce((total, value) => {
    if (!Number.isFinite(value)) {
      throw new Error("Token totals must be finite numbers");
    }
    if (value < 0) {
      throw new Error("Token totals cannot be negative");
    }
    return total + Math.trunc(value);
  }, 0);
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return `${Math.trunc(value)}`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
```

- [ ] **Step 5: Write failing schema tests**

Create `packages/shared/src/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { providerSchema, syncPayloadSchema } from "./schemas";

describe("providerSchema", () => {
  it("accepts MVP providers", () => {
    expect(providerSchema.parse("claude_code")).toBe("claude_code");
    expect(providerSchema.parse("codex")).toBe("codex");
  });
});

describe("syncPayloadSchema", () => {
  it("accepts aggregate daily provider snapshots", () => {
    const payload = syncPayloadSchema.parse({
      provider: "codex",
      date: "2026-05-31",
      tokenCategories: {
        input: 100,
        output: 200,
        cacheCreate: 50,
        cacheRead: 25,
      },
      totalTokens: 375,
      cliVersion: "0.1.0",
      ccusageVersion: "1.2.3",
      os: "linux",
      syncedAt: "2026-05-31T23:00:00.000Z",
    });

    expect(payload.totalTokens).toBe(375);
  });

  it("rejects unknown providers and negative totals", () => {
    expect(() =>
      syncPayloadSchema.parse({
        provider: "other",
        date: "2026-05-31",
        tokenCategories: { input: -1 },
        totalTokens: -1,
        cliVersion: "0.1.0",
        ccusageVersion: "1.2.3",
        os: "linux",
        syncedAt: "2026-05-31T23:00:00.000Z",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 6: Implement shared schemas**

Create `packages/shared/src/schemas.ts`:

```ts
import { z } from "zod";

export const providerSchema = z.enum(["claude_code", "codex"]);
export type Provider = z.infer<typeof providerSchema>;

export const periodSchema = z.enum(["daily", "weekly", "monthly", "all-time"]);
export type LeaderboardPeriod = z.infer<typeof periodSchema>;

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const tokenCategoriesSchema = z.record(z.string(), z.number().int().nonnegative());

export const syncPayloadSchema = z.object({
  provider: providerSchema,
  date: isoDateSchema,
  tokenCategories: tokenCategoriesSchema,
  totalTokens: z.number().int().nonnegative(),
  cliVersion: z.string().min(1),
  ccusageVersion: z.string().min(1),
  os: z.enum(["darwin", "linux", "win32"]),
  syncedAt: z.string().datetime(),
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;

export const leaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  displayName: z.string().min(1).max(32),
  totalTokens: z.number().int().nonnegative(),
});

export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;
```

Create `packages/shared/src/index.ts`:

```ts
export * from "./schemas";
export * from "./tokens";
```

- [ ] **Step 7: Verify shared package**

Run:

```bash
pnpm --filter @token-burn/shared test
pnpm --filter @token-burn/shared typecheck
pnpm --filter @token-burn/shared build
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add packages/shared package.json pnpm-lock.yaml
git commit -m "feat: add shared token schemas"
```

Expected: commit succeeds.

---

### Task 3: Web App Scaffold, shadcn, and Database Schema

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.mjs`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/components.json`
- Create: `apps/web/prisma/schema.prisma`
- Create: `apps/web/src/lib/env.ts`
- Create: `apps/web/src/lib/prisma.ts`
- Create: `apps/web/src/lib/time.ts`
- Test: `apps/web/src/lib/time.test.ts`

- [ ] **Step 1: Create web package files**

Create `apps/web/package.json`:

```json
{
  "name": "@token-burn/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "next build",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "dev": "next dev",
    "lint": "next lint",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@auth/prisma-adapter": "^2.9.1",
    "@prisma/client": "^6.8.2",
    "@radix-ui/react-dialog": "^1.1.14",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-tabs": "^1.1.12",
    "@token-burn/shared": "workspace:*",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.511.0",
    "next": "^15.3.3",
    "next-auth": "5.0.0-beta.28",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "sonner": "^2.0.3",
    "tailwind-merge": "^3.3.0",
    "tailwindcss-animate": "^1.0.7",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.8",
    "@types/react": "^19.1.6",
    "@types/react-dom": "^19.1.5",
    "autoprefixer": "^10.4.21",
    "prisma": "^6.8.2",
    "tailwindcss": "^4.1.8",
    "typescript": "^5.8.3",
    "vitest": "^3.1.4"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "allowJs": true,
    "incremental": true,
    "jsx": "preserve",
    "module": "ESNext",
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `apps/web/next.config.mjs`:

```js
/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Create shadcn/Tailwind base**

Create `apps/web/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Create `apps/web/postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

Create `apps/web/tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
```

- [ ] **Step 3: Create Prisma schema**

Create `apps/web/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String   @id @default(cuid())
  githubId      String   @unique
  githubLogin   String   @unique
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  member        Member?
  createdInvites Invite[] @relation("InviteCreator")
}

model Member {
  id          String   @id @default(cuid())
  userId      String   @unique
  displayName String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  cliTokens   CliToken[]
  usage       DailyProviderUsage[]
}

model Invite {
  id           String    @id @default(cuid())
  codeHash     String    @unique
  createdById  String
  redeemedById String?
  expiresAt    DateTime
  redeemedAt   DateTime?
  createdAt    DateTime  @default(now())
  createdBy    User      @relation("InviteCreator", fields: [createdById], references: [id], onDelete: Cascade)
}

model CliLoginSession {
  id          String    @id @default(cuid())
  codeHash    String    @unique
  memberId    String?
  approvedAt  DateTime?
  expiresAt   DateTime
  createdAt   DateTime  @default(now())
}

model CliToken {
  id          String    @id @default(cuid())
  tokenHash   String    @unique
  memberId    String
  label       String
  lastUsedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  member      Member    @relation(fields: [memberId], references: [id], onDelete: Cascade)
}

model DailyProviderUsage {
  id              String   @id @default(cuid())
  memberId        String
  provider        String
  date            DateTime
  tokenCategories Json
  totalTokens     BigInt
  cliVersion      String
  ccusageVersion  String
  os              String
  syncedAt        DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  member          Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@unique([memberId, provider, date])
  @@index([provider, date])
  @@index([date])
}
```

- [ ] **Step 4: Write failing period-boundary tests**

Create `apps/web/src/lib/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getPeriodRange } from "./time";

describe("getPeriodRange", () => {
  it("uses UTC day boundaries", () => {
    const range = getPeriodRange("daily", new Date("2026-05-31T23:30:00.000Z"));
    expect(range).toEqual({
      start: new Date("2026-05-31T00:00:00.000Z"),
      end: new Date("2026-06-01T00:00:00.000Z"),
    });
  });

  it("uses ISO week boundaries", () => {
    const range = getPeriodRange("weekly", new Date("2026-05-31T12:00:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-05-25T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("uses UTC month boundaries", () => {
    const range = getPeriodRange("monthly", new Date("2026-05-31T12:00:00.000Z"));
    expect(range.start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("returns an open range for all-time", () => {
    expect(getPeriodRange("all-time", new Date("2026-05-31T12:00:00.000Z"))).toEqual({
      start: null,
      end: null,
    });
  });
});
```

- [ ] **Step 5: Implement environment, Prisma, and time helpers**

Create `apps/web/src/lib/env.ts`:

```ts
import { z } from "zod";

const envSchema = z.object({
  ADMIN_GITHUB_LOGIN: z.string().min(1),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  TOKEN_BURN_PUBLIC_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
```

Create `apps/web/src/lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Create `apps/web/src/lib/time.ts`:

```ts
import type { LeaderboardPeriod } from "@token-burn/shared";

type PeriodRange = { start: Date | null; end: Date | null };

export function getPeriodRange(period: LeaderboardPeriod, now = new Date()): PeriodRange {
  if (period === "all-time") return { start: null, end: null };

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  if (period === "daily") {
    const start = new Date(Date.UTC(year, month, date));
    return { start, end: addUtcDays(start, 1) };
  }

  if (period === "monthly") {
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    return { start, end };
  }

  const day = now.getUTCDay() || 7;
  const start = new Date(Date.UTC(year, month, date - day + 1));
  return { start, end: addUtcDays(start, 7) };
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 6: Verify web foundation**

Run:

```bash
pnpm install
pnpm --filter @token-burn/web db:generate
pnpm --filter @token-burn/web test -- time.test.ts
pnpm --filter @token-burn/web typecheck
```

Expected: tests, Prisma generation, and typecheck pass after env imports are not evaluated in tests that do not need env.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat: scaffold web app database foundation"
```

Expected: commit succeeds.

---

### Task 4: Leaderboard Query and Public UI

**Files:**
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/leaderboard-table.tsx`
- Create: `apps/web/src/components/period-tabs.tsx`
- Create: `apps/web/src/components/ui/button.tsx`
- Create: `apps/web/src/components/ui/table.tsx`
- Create: `apps/web/src/components/ui/tabs.tsx`
- Create: `apps/web/src/lib/utils.ts`
- Create: `apps/web/src/server/leaderboard.ts`
- Test: `apps/web/src/server/leaderboard.test.ts`

- [ ] **Step 1: Add shadcn utility and UI primitives**

Create `apps/web/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Create the shadcn primitives with:

```bash
cd apps/web
pnpm dlx shadcn@latest add button table tabs
```

Expected: `src/components/ui/button.tsx`, `table.tsx`, and `tabs.tsx` exist and use the `@/lib/utils` alias.

- [ ] **Step 2: Write failing leaderboard query test**

Create `apps/web/src/server/leaderboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rankRows } from "./leaderboard";

describe("rankRows", () => {
  it("sorts by total tokens descending and assigns ranks", () => {
    expect(
      rankRows([
        { displayName: "Ada", totalTokens: 100n },
        { displayName: "Linus", totalTokens: 300n },
        { displayName: "Grace", totalTokens: 200n },
      ]),
    ).toEqual([
      { rank: 1, displayName: "Linus", totalTokens: 300 },
      { rank: 2, displayName: "Grace", totalTokens: 200 },
      { rank: 3, displayName: "Ada", totalTokens: 100 },
    ]);
  });
});
```

- [ ] **Step 3: Implement leaderboard server helper**

Create `apps/web/src/server/leaderboard.ts`:

```ts
import type { LeaderboardPeriod, LeaderboardRow } from "@token-burn/shared";
import { getPeriodRange } from "@/lib/time";
import { prisma } from "@/lib/prisma";

type RawRow = { displayName: string; totalTokens: bigint };

export function rankRows(rows: RawRow[]): LeaderboardRow[] {
  return [...rows]
    .sort((a, b) => Number(b.totalTokens - a.totalTokens))
    .map((row, index) => ({
      rank: index + 1,
      displayName: row.displayName,
      totalTokens: Number(row.totalTokens),
    }));
}

export async function getLeaderboard(period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
  const range = getPeriodRange(period);
  const dateFilter =
    range.start && range.end
      ? {
          gte: range.start,
          lt: range.end,
        }
      : undefined;

  const rows = await prisma.member.findMany({
    select: {
      displayName: true,
      usage: {
        where: dateFilter ? { date: dateFilter } : {},
        select: { totalTokens: true },
      },
    },
  });

  return rankRows(
    rows.map((row) => ({
      displayName: row.displayName,
      totalTokens: row.usage.reduce((sum, usage) => sum + usage.totalTokens, 0n),
    })),
  ).filter((row) => row.totalTokens > 0);
}
```

- [ ] **Step 4: Implement public page**

Create `apps/web/src/app/globals.css` using shadcn CSS variables, then keep the layout restrained:

```css
@import "tailwindcss";

:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 9%;
  --muted: 0 0% 96%;
  --muted-foreground: 0 0% 45%;
  --border: 0 0% 89%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
}

body {
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}
```

Create `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Token Burn",
  description: "A public token usage leaderboard for invited AI tool users.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `apps/web/src/components/period-tabs.tsx`:

```tsx
import type { LeaderboardPeriod } from "@token-burn/shared";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const periods: Array<{ value: LeaderboardPeriod; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "all-time", label: "All-time" },
];

export function PeriodTabs({ value }: { value: LeaderboardPeriod }) {
  return (
    <Tabs value={value} className="w-full">
      <TabsList>
        {periods.map((period) => (
          <TabsTrigger key={period.value} value={period.value} asChild>
            <a href={`/?period=${period.value}`}>{period.label}</a>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
```

Create `apps/web/src/components/leaderboard-table.tsx`:

```tsx
import type { LeaderboardRow } from "@token-burn/shared";
import { formatTokens } from "@token-burn/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return <div className="rounded-md border p-8 text-sm text-muted-foreground">No tokens burned yet.</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">Rank</TableHead>
          <TableHead>Display Name</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.rank}>
            <TableCell className="font-mono text-muted-foreground">#{row.rank}</TableCell>
            <TableCell className="font-medium">{row.displayName}</TableCell>
            <TableCell className="text-right font-mono">{formatTokens(row.totalTokens)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

Create `apps/web/src/app/page.tsx`:

```tsx
import { periodSchema, type LeaderboardPeriod } from "@token-burn/shared";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { PeriodTabs } from "@/components/period-tabs";
import { getLeaderboard } from "@/server/leaderboard";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const period: LeaderboardPeriod = periodSchema.catch("daily").parse(params.period);
  const rows = await getLeaderboard(period);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-8">
      <header className="flex flex-col gap-3 border-b pb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">Token Burn</h1>
          <p className="mt-2 text-sm text-muted-foreground">Public leaderboard. Private submissions.</p>
        </div>
        <PeriodTabs value={period} />
      </header>
      <LeaderboardTable rows={rows} />
    </main>
  );
}
```

- [ ] **Step 5: Verify public UI**

Run:

```bash
pnpm --filter @token-burn/web test -- leaderboard.test.ts
pnpm --filter @token-burn/web typecheck
pnpm --filter @token-burn/web build
```

Expected: all commands pass after env variables are provided for build through `.env.local`.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat: add public leaderboard UI"
```

Expected: commit succeeds.

---

### Task 5: GitHub OAuth, Invites, and Member Setup

**Files:**
- Create: `apps/web/src/auth.ts`
- Create: `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/src/server/invites.ts`
- Create: `apps/web/src/server/display-name.ts`
- Create: `apps/web/src/app/invite/[code]/page.tsx`
- Create: `apps/web/src/app/settings/display-name/page.tsx`
- Create: `apps/web/src/app/admin/invites/page.tsx`
- Test: `apps/web/src/server/invites.test.ts`
- Test: `apps/web/src/server/display-name.test.ts`

- [ ] **Step 1: Write invite and display-name tests**

Create `apps/web/src/server/display-name.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "./display-name";

describe("normalizeDisplayName", () => {
  it("trims names and limits public names to 32 characters", () => {
    expect(normalizeDisplayName("  Token Wizard  ")).toBe("Token Wizard");
    expect(() => normalizeDisplayName("x".repeat(33))).toThrow("Display name must be 32 characters or fewer");
  });

  it("rejects empty names", () => {
    expect(() => normalizeDisplayName("   ")).toThrow("Display name is required");
  });
});
```

Create `apps/web/src/server/invites.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashInviteCode, isInviteExpired } from "./invites";

describe("hashInviteCode", () => {
  it("hashes invite codes deterministically without storing raw codes", () => {
    expect(hashInviteCode("abc")).toBe(hashInviteCode("abc"));
    expect(hashInviteCode("abc")).not.toBe("abc");
  });
});

describe("isInviteExpired", () => {
  it("treats expiration as exclusive", () => {
    expect(isInviteExpired(new Date("2026-05-31T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toBe(true);
    expect(isInviteExpired(new Date("2026-05-31T00:00:01.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: Implement invite and display helpers**

Create `apps/web/src/server/display-name.ts`:

```ts
export function normalizeDisplayName(input: string): string {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length === 0) throw new Error("Display name is required");
  if (value.length > 32) throw new Error("Display name must be 32 characters or fewer");
  return value;
}
```

Create `apps/web/src/server/invites.ts`:

```ts
import crypto from "node:crypto";

export function createInviteCode(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashInviteCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function isInviteExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function createInviteExpiration(now = new Date()): Date {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}
```

- [ ] **Step 3: Configure Auth.js with GitHub**

Create `apps/web/src/auth.ts`:

```ts
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const githubId = String(profile?.id ?? "");
      const githubLogin = String(profile?.login ?? "");
      if (!githubId || !githubLogin) return false;

      await prisma.user.upsert({
        where: { githubId },
        update: { githubLogin },
        create: { githubId, githubLogin },
      });

      return true;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = token.name;
      }
      return session;
    },
  },
});
```

Create `apps/web/src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 4: Implement pages with server actions**

Create invite, display-name, and admin pages using server actions that call Prisma and helpers from this task. The actions must:

- Require `auth()` for member/admin pages.
- Check `session.user` and look up the local `User` by GitHub login.
- Allow admin actions only when `user.githubLogin === env.ADMIN_GITHUB_LOGIN`.
- Store only `codeHash`, never raw invite code.
- Redirect successful display-name setup to `/`.

Use shadcn `Button`, `Input`, and `Label` components:

```bash
cd apps/web
pnpm dlx shadcn@latest add input label
```

Expected: invite acceptance creates a `Member`, display-name setup updates the member, and admin invite creation renders a copyable invite URL once.

- [ ] **Step 5: Verify auth helpers**

Run:

```bash
pnpm --filter @token-burn/web test -- invites.test.ts display-name.test.ts
pnpm --filter @token-burn/web typecheck
```

Expected: helper tests and typecheck pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat: add invite-based GitHub membership"
```

Expected: commit succeeds.

---

### Task 6: CLI Login Sessions and Sync API

**Files:**
- Create: `apps/web/src/server/cli-auth.ts`
- Create: `apps/web/src/app/api/cli/login/start/route.ts`
- Create: `apps/web/src/app/api/cli/login/poll/route.ts`
- Create: `apps/web/src/app/cli/approve/[code]/page.tsx`
- Create: `apps/web/src/app/api/sync/route.ts`
- Test: `apps/web/src/server/cli-auth.test.ts`

- [ ] **Step 1: Write CLI auth helper tests**

Create `apps/web/src/server/cli-auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createCliLoginCode, hashSecret, isCliLoginExpired } from "./cli-auth";

describe("cli auth helpers", () => {
  it("creates human-copyable login codes", () => {
    expect(createCliLoginCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("hashes secrets deterministically", () => {
    expect(hashSecret("secret")).toBe(hashSecret("secret"));
    expect(hashSecret("secret")).not.toBe("secret");
  });

  it("expires login sessions at the exact expiration time", () => {
    expect(isCliLoginExpired(new Date("2026-05-31T00:10:00.000Z"), new Date("2026-05-31T00:10:00.000Z"))).toBe(true);
  });
});
```

- [ ] **Step 2: Implement CLI auth helpers**

Create `apps/web/src/server/cli-auth.ts`:

```ts
import crypto from "node:crypto";

export function createCliLoginCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  for (let index = 0; index < 8; index += 1) {
    raw += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createCliLoginExpiration(now = new Date()): Date {
  return new Date(now.getTime() + 10 * 60 * 1000);
}

export function createCliToken(): string {
  return `tb_${crypto.randomBytes(32).toString("base64url")}`;
}

export function isCliLoginExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
```

- [ ] **Step 3: Implement API routes**

Create routes with these contracts:

`POST /api/cli/login/start`

```json
{
  "loginUrl": "https://example.test/cli/approve/ABCD-EFGH",
  "pollToken": "opaque-poll-token",
  "expiresAt": "2026-05-31T00:10:00.000Z"
}
```

`POST /api/cli/login/poll`

```json
{
  "status": "pending"
}
```

or:

```json
{
  "status": "approved",
  "token": "tb_local-token",
  "member": {
    "displayName": "Token Burner"
  }
}
```

`POST /api/sync`

```json
{
  "accepted": true
}
```

Implementation requirements:

- Hash all poll tokens and CLI tokens before storage.
- Return `401` for missing, invalid, expired, or revoked CLI tokens on `/api/sync`.
- Parse request bodies with `syncPayloadSchema`.
- Upsert `daily_provider_usage` by `memberId + provider + date`.
- Convert the ISO date string to `Date.UTC(year, month - 1, day)`.

- [ ] **Step 4: Verify API types**

Run:

```bash
pnpm --filter @token-burn/web test -- cli-auth.test.ts
pnpm --filter @token-burn/web typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web package.json pnpm-lock.yaml
git commit -m "feat: add cli login and sync APIs"
```

Expected: commit succeeds.

---

### Task 7: CLI Scaffold, Config, and Login Flow

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/config.ts`
- Create: `packages/cli/src/http.ts`
- Create: `packages/cli/src/commands/login.ts`
- Create: `packages/cli/src/commands/logout.ts`
- Create: `packages/cli/src/commands/status.ts`
- Test: `packages/cli/src/config.test.ts`
- Test: `packages/cli/src/commands/login.test.ts`

- [ ] **Step 1: Create CLI package**

Create `packages/cli/package.json`:

```json
{
  "name": "token-burn",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "token-burn": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/index.ts",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@token-burn/shared": "workspace:*",
    "ccusage": "^16.2.0",
    "commander": "^14.0.0",
    "keytar": "^7.9.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.0",
    "tsx": "^4.19.4",
    "vitest": "^3.1.4"
  }
}
```

Create `packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write config tests**

Create `packages/cli/src/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getConfigPath } from "./config";

describe("getConfigPath", () => {
  it("uses TOKEN_BURN_CONFIG_DIR when provided", () => {
    expect(getConfigPath({ TOKEN_BURN_CONFIG_DIR: "/tmp/token-burn" })).toBe("/tmp/token-burn/config.json");
  });
});
```

- [ ] **Step 3: Implement config storage**

Create `packages/cli/src/config.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const configSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string().min(1).optional(),
  lastSync: z
    .object({
      ok: z.boolean(),
      message: z.string(),
      at: z.string().datetime(),
    })
    .optional(),
});

export type CliConfig = z.infer<typeof configSchema>;

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.TOKEN_BURN_CONFIG_DIR ?? path.join(os.homedir(), ".config", "token-burn");
  return path.join(dir, "config.json");
}

export async function readConfig(): Promise<CliConfig | null> {
  try {
    const text = await fs.readFile(getConfigPath(), "utf8");
    return configSchema.parse(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeConfig(config: CliConfig): Promise<void> {
  const file = getConfigPath();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
```

- [ ] **Step 4: Implement CLI entry and login command**

Create `packages/cli/src/http.ts`:

```ts
export async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as T;
}
```

Create `packages/cli/src/commands/login.ts`:

```ts
import { postJson } from "../http";
import { writeConfig } from "../config";

type StartResponse = { loginUrl: string; pollToken: string; expiresAt: string };
type PollResponse =
  | { status: "pending" }
  | { status: "approved"; token: string; member: { displayName: string } };

export async function login(serverUrl: string): Promise<void> {
  const start = await postJson<StartResponse>(`${serverUrl}/api/cli/login/start`, {});
  console.log("Open this URL in your browser to authenticate:");
  console.log("");
  console.log(start.loginUrl);
  console.log("");
  console.log("Waiting for authentication...");

  const deadline = new Date(start.expiresAt).getTime();
  while (Date.now() < deadline) {
    await sleep(3000);
    const poll = await postJson<PollResponse>(`${serverUrl}/api/cli/login/poll`, {
      pollToken: start.pollToken,
    });
    if (poll.status === "approved") {
      await writeConfig({ serverUrl, token: poll.token });
      console.log(`Authenticated as ${poll.member.displayName}.`);
      return;
    }
  }

  throw new Error("Login expired. Run token-burn login again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Create `packages/cli/src/commands/logout.ts`:

```ts
import { readConfig, writeConfig } from "../config";

export async function logout(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    console.log("No Token Burn login found.");
    return;
  }
  await writeConfig({ serverUrl: config.serverUrl });
  console.log("Logged out.");
}
```

Create `packages/cli/src/commands/status.ts`:

```ts
import { readConfig } from "../config";

export async function status(): Promise<void> {
  const config = await readConfig();
  if (!config?.token) {
    console.log("Not logged in. Run token-burn login --server <url>.");
    return;
  }
  console.log(`Logged in to ${config.serverUrl}.`);
  if (config.lastSync) {
    console.log(`Last sync: ${config.lastSync.ok ? "ok" : "failed"} at ${config.lastSync.at}`);
    console.log(config.lastSync.message);
  }
}
```

Create `packages/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { status } from "./commands/status";

const program = new Command();

program.name("token-burn").description("Sync AI token usage to Token Burn.").version("0.1.0");

program
  .command("login")
  .requiredOption("--server <url>", "Token Burn server URL")
  .action(async (options: { server: string }) => login(options.server));

program.command("logout").action(logout);
program.command("status").action(status);

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 5: Verify CLI login package**

Run:

```bash
pnpm --filter token-burn test
pnpm --filter token-burn typecheck
pnpm --filter token-burn build
```

Expected: tests, typecheck, and build pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/cli package.json pnpm-lock.yaml
git commit -m "feat: add token burn cli login"
```

Expected: commit succeeds.

---

### Task 8: ccusage Normalization and Sync Command

**Files:**
- Create: `packages/cli/src/ccusage.ts`
- Create: `packages/cli/src/sync.ts`
- Create: `packages/cli/src/commands/sync.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/ccusage.test.ts`
- Test: `packages/cli/src/sync.test.ts`

- [ ] **Step 1: Write ccusage normalization tests**

Create `packages/cli/src/ccusage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeCcusageDailyRows } from "./ccusage";

describe("normalizeCcusageDailyRows", () => {
  it("normalizes common daily token fields into shared token categories", () => {
    const rows = normalizeCcusageDailyRows("codex", [
      {
        date: "2026-05-31",
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationTokens: 50,
        cacheReadTokens: 25,
      },
    ]);

    expect(rows).toEqual([
      {
        provider: "codex",
        date: "2026-05-31",
        tokenCategories: {
          input: 100,
          output: 200,
          cacheCreate: 50,
          cacheRead: 25,
        },
        totalTokens: 375,
      },
    ]);
  });
});
```

- [ ] **Step 2: Implement ccusage adapter**

Create `packages/cli/src/ccusage.ts`:

```ts
import { spawn } from "node:child_process";
import type { Provider } from "@token-burn/shared";
import { sumTokenCategories } from "@token-burn/shared";

type NormalizedUsage = {
  provider: Provider;
  date: string;
  tokenCategories: Record<string, number>;
  totalTokens: number;
};

export function normalizeCcusageDailyRows(provider: Provider, rows: Array<Record<string, unknown>>): NormalizedUsage[] {
  return rows.map((row) => {
    const tokenCategories = {
      input: readNumber(row, ["inputTokens", "input_tokens", "input"]),
      output: readNumber(row, ["outputTokens", "output_tokens", "output"]),
      cacheCreate: readNumber(row, ["cacheCreationTokens", "cacheCreateTokens", "cache_creation_tokens"]),
      cacheRead: readNumber(row, ["cacheReadTokens", "cache_read_tokens"]),
    };

    return {
      provider,
      date: String(row.date),
      tokenCategories,
      totalTokens: sumTokenCategories(tokenCategories),
    };
  });
}

export async function readProviderUsage(provider: Provider): Promise<NormalizedUsage[]> {
  const source = provider === "claude_code" ? "claude" : "codex";
  const output = await runCcusage([source, "daily", "--json"]);
  const parsed = JSON.parse(output) as { daily?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const rows = Array.isArray(parsed) ? parsed : parsed.daily ?? [];
  return normalizeCcusageDailyRows(provider, rows);
}

function readNumber(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  }
  return 0;
}

function runCcusage(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("ccusage", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `ccusage exited with code ${code}`));
    });
  });
}
```

- [ ] **Step 3: Implement sync command**

Create `packages/cli/src/sync.ts`:

```ts
import os from "node:os";
import { syncPayloadSchema } from "@token-burn/shared";
import { readConfig, writeConfig } from "./config";
import { postJson } from "./http";
import { readProviderUsage } from "./ccusage";

const providers = ["claude_code", "codex"] as const;

export async function syncUsage(): Promise<void> {
  const config = await readConfig();
  if (!config?.token) throw new Error("Not logged in. Run token-burn login --server <url>.");

  const errors: string[] = [];
  let submitted = 0;

  for (const provider of providers) {
    try {
      const rows = await readProviderUsage(provider);
      for (const row of rows) {
        const payload = syncPayloadSchema.parse({
          ...row,
          cliVersion: "0.1.0",
          ccusageVersion: "bundled",
          os: os.platform(),
          syncedAt: new Date().toISOString(),
        });
        await postJson(`${config.serverUrl}/api/sync`, payload, config.token);
        submitted += 1;
      }
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const ok = errors.length === 0;
  await writeConfig({
    ...config,
    lastSync: {
      ok,
      message: ok ? `Submitted ${submitted} daily provider snapshots.` : errors.join("; "),
      at: new Date().toISOString(),
    },
  });

  if (!ok && submitted === 0) throw new Error(errors.join("; "));
  console.log(`Submitted ${submitted} daily provider snapshots.`);
}
```

Create `packages/cli/src/commands/sync.ts`:

```ts
import { syncUsage } from "../sync";

export async function syncCommand(): Promise<void> {
  await syncUsage();
}
```

Modify `packages/cli/src/index.ts`:

```ts
import { syncCommand } from "./commands/sync";

program.command("sync").action(syncCommand);
```

- [ ] **Step 4: Verify CLI sync**

Run:

```bash
pnpm --filter token-burn test -- ccusage.test.ts sync.test.ts
pnpm --filter token-burn typecheck
pnpm --filter token-burn build
```

Expected: tests, typecheck, and build pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/cli package.json pnpm-lock.yaml
git commit -m "feat: sync ccusage aggregate totals"
```

Expected: commit succeeds.

---

### Task 9: Scheduler and Doctor Commands

**Files:**
- Create: `packages/cli/src/scheduler.ts`
- Create: `packages/cli/src/commands/scheduler.ts`
- Create: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/scheduler.test.ts`

- [ ] **Step 1: Write scheduler tests**

Create `packages/cli/src/scheduler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCronLine, buildLaunchdPlist, buildWindowsTaskCommand } from "./scheduler";

describe("scheduler command builders", () => {
  it("builds a 15-minute cron line", () => {
    expect(buildCronLine("/usr/bin/token-burn")).toContain("*/15 * * * * /usr/bin/token-burn sync");
  });

  it("builds launchd StartInterval 900", () => {
    expect(buildLaunchdPlist("/usr/local/bin/token-burn")).toContain("<integer>900</integer>");
  });

  it("builds a Windows scheduled task command", () => {
    expect(buildWindowsTaskCommand("C:\\\\bin\\\\token-burn.cmd")).toContain("/SC MINUTE /MO 15");
  });
});
```

- [ ] **Step 2: Implement scheduler builders**

Create `packages/cli/src/scheduler.ts`:

```ts
export function buildCronLine(binaryPath: string): string {
  return `*/15 * * * * ${binaryPath} sync >/tmp/token-burn-sync.log 2>&1`;
}

export function buildLaunchdPlist(binaryPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.token-burn.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binaryPath}</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
</dict>
</plist>
`;
}

export function buildWindowsTaskCommand(binaryPath: string): string {
  return `schtasks /Create /TN TokenBurnSync /SC MINUTE /MO 15 /TR "${binaryPath} sync" /F`;
}
```

- [ ] **Step 3: Implement scheduler and doctor command shells**

Create `packages/cli/src/commands/scheduler.ts`:

```ts
import { buildCronLine, buildLaunchdPlist, buildWindowsTaskCommand } from "../scheduler";

export async function installScheduler(options: { dryRun?: boolean }): Promise<void> {
  const binary = process.argv[1] ?? "token-burn";
  const platform = process.platform;
  const preview =
    platform === "darwin"
      ? buildLaunchdPlist(binary)
      : platform === "win32"
        ? buildWindowsTaskCommand(binary)
        : buildCronLine(binary);

  if (options.dryRun) {
    console.log(preview);
    return;
  }

  console.log("Run with --dry-run first, then use the generated platform command.");
}

export async function uninstallScheduler(): Promise<void> {
  console.log("Remove the Token Burn scheduler using your platform scheduler tool.");
}
```

Create `packages/cli/src/commands/doctor.ts`:

```ts
import { readConfig } from "../config";

export async function doctor(): Promise<void> {
  const config = await readConfig();
  console.log(config?.token ? "Auth: ok" : "Auth: missing");
  console.log(`Platform: ${process.platform}`);
  console.log("Run token-burn sync to validate ccusage and server connectivity.");
}
```

Modify `packages/cli/src/index.ts`:

```ts
import { doctor } from "./commands/doctor";
import { installScheduler, uninstallScheduler } from "./commands/scheduler";

program.command("doctor").action(doctor);
program.command("install-scheduler").option("--dry-run", "print scheduler configuration").action(installScheduler);
program.command("uninstall-scheduler").action(uninstallScheduler);
```

- [ ] **Step 4: Verify scheduler package**

Run:

```bash
pnpm --filter token-burn test -- scheduler.test.ts
pnpm --filter token-burn typecheck
pnpm --filter token-burn build
```

Expected: tests, typecheck, and build pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/cli
git commit -m "feat: add scheduler and doctor commands"
```

Expected: commit succeeds.

---

### Task 10: Deployment, Environment, and End-to-End Smoke

**Files:**
- Create: `.env.example`
- Create: `docker-compose.yml`
- Create: `apps/web/Dockerfile`
- Create: `docs/deploy-vps.md`
- Create: `apps/web/tests/leaderboard.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Create environment example**

Create `.env.example`:

```dotenv
ADMIN_GITHUB_LOGIN=octocat
AUTH_GITHUB_ID=github-client-id
AUTH_GITHUB_SECRET=github-client-secret
AUTH_SECRET=generate-with-openssl-rand-base64-32
AUTH_URL=https://tokenburn.example.com
DATABASE_URL=postgresql://tokenburn:tokenburn@postgres:5432/tokenburn
TOKEN_BURN_PUBLIC_URL=https://tokenburn.example.com
POSTGRES_DB=tokenburn
POSTGRES_USER=tokenburn
POSTGRES_PASSWORD=change-this-password
```

- [ ] **Step 2: Create Docker files**

Create `apps/web/Dockerfile`:

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --filter @token-burn/shared build
RUN pnpm --filter @token-burn/web db:generate
RUN pnpm --filter @token-burn/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    restart: unless-stopped
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:3000:3000"

volumes:
  postgres-data:
```

- [ ] **Step 3: Write VPS deployment docs**

Create `docs/deploy-vps.md`:

```md
# Token Burn VPS Deployment

Token Burn runs behind the host-level Caddy reverse proxy. Docker Compose runs Postgres and the Next.js web app.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in GitHub OAuth values, `AUTH_SECRET`, `ADMIN_GITHUB_LOGIN`, and Postgres credentials.
3. Run `docker compose build`.
4. Run `docker compose up -d`.
5. Point Caddy at `127.0.0.1:3000`.

## Caddy Route

```caddyfile
tokenburn.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## Database Backup

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > tokenburn-$(date -u +%Y%m%dT%H%M%SZ).sql
```

## Restore

```bash
cat backup.sql | docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```
```

- [ ] **Step 4: Add Playwright smoke test**

Install:

```bash
pnpm --filter @token-burn/web add -D @playwright/test
```

Create `apps/web/tests/leaderboard.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("public leaderboard renders without authentication", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Token Burn" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Daily" })).toBeVisible();
  await expect(page.getByText(/No tokens burned yet|Tokens/)).toBeVisible();
});
```

Add to `apps/web/package.json` scripts:

```json
{
  "test:e2e": "playwright test"
}
```

- [ ] **Step 5: Verify full MVP**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
docker compose config
```

Expected: tests, typecheck, build, and Compose validation pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add .env.example docker-compose.yml apps/web/Dockerfile docs/deploy-vps.md apps/web/tests apps/web/package.json package.json pnpm-lock.yaml
git commit -m "chore: add docker deployment and smoke test"
```

Expected: commit succeeds.

---

## Final Manual Acceptance

- [ ] Start Postgres and web locally with Docker Compose.
- [ ] Run Prisma migrations against Postgres.
- [ ] Visit the public leaderboard without logging in and confirm it renders.
- [ ] Sign in with GitHub as `ADMIN_GITHUB_LOGIN`.
- [ ] Create an invite link from the admin page.
- [ ] Redeem the invite as a member and set a custom display name.
- [ ] Build the CLI with `pnpm --filter token-burn build`.
- [ ] Run `node packages/cli/dist/index.js login --server http://localhost:3000`.
- [ ] Copy the printed URL into a browser, approve the CLI, and confirm the CLI stores the token.
- [ ] Run `node packages/cli/dist/index.js sync`.
- [ ] Confirm the leaderboard updates for daily, weekly, monthly, and all-time.
- [ ] Run `node packages/cli/dist/index.js install-scheduler --dry-run` on macOS, Linux, and Windows where available.
- [ ] Confirm public pages do not expose GitHub username, provider breakdowns, sessions, commands, project names, or profile links.
