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
