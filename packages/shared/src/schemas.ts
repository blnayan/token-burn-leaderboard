import { z } from "zod";
import { sumTokenCategories } from "./tokens.js";

export const providerSchema = z.enum(["claude_code", "codex"]);
export type Provider = z.infer<typeof providerSchema>;

export const periodSchema = z.enum(["daily", "weekly", "monthly", "all-time"]);
export type LeaderboardPeriod = z.infer<typeof periodSchema>;

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const tokenCategoriesSchema = z.record(z.string(), z.number().int().nonnegative().safe());

const costUsdSchema = z.number().finite().nonnegative().max(1_000_000);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const tokenDetailsSchema = z.record(z.string(), z.number().int().nonnegative().safe());

export const syncModelUsageSchema = z
  .object({
    modelName: z.string().trim().min(1).max(160),
    tokenCategories: tokenCategoriesSchema,
    tokenDetails: tokenDetailsSchema.optional(),
    totalTokens: z.number().int().nonnegative().safe(),
    costUsd: costUsdSchema.optional(),
    metadata: jsonObjectSchema.optional(),
  })
  .refine((model) => model.totalTokens === sumTokenCategories(model.tokenCategories), {
    message: "model totalTokens must equal the sum of tokenCategories",
    path: ["totalTokens"],
  });

export type SyncModelUsage = z.infer<typeof syncModelUsageSchema>;

export const syncPayloadSchema = z
  .object({
    provider: providerSchema,
    date: isoDateSchema,
    tokenCategories: tokenCategoriesSchema,
    tokenDetails: tokenDetailsSchema.optional(),
    totalTokens: z.number().int().nonnegative().safe(),
    costUsd: costUsdSchema.optional(),
    costSource: z.literal("ccusage").optional(),
    costMetadata: jsonObjectSchema.optional(),
    sourceSnapshot: jsonObjectSchema.optional(),
    models: z.array(syncModelUsageSchema).max(500).optional(),
    deviceId: z.string().uuid(),
    deviceName: z.string().trim().min(1).max(80),
    cliVersion: z.string().min(1),
    ccusageVersion: z.string().min(1),
    os: z.enum(["darwin", "linux", "win32"]),
    syncedAt: z.string().datetime(),
  })
  .refine((payload) => payload.totalTokens === sumTokenCategories(payload.tokenCategories), {
    message: "totalTokens must equal the sum of tokenCategories",
    path: ["totalTokens"],
  });

export type SyncPayload = z.infer<typeof syncPayloadSchema>;

export const leaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  displayName: z.string().min(1).max(32),
  totalTokens: z.number().int().nonnegative(),
});

export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;
