import { z } from "zod";
import { sumTokenCategories } from "./tokens.js";

export const providerSchema = z.enum(["claude_code", "codex"]);
export const providers = providerSchema.options;
export type Provider = z.infer<typeof providerSchema>;

export const periodSchema = z.enum(["daily", "weekly", "monthly", "all-time"]);
export type LeaderboardPeriod = z.infer<typeof periodSchema>;

export const memberUsageRangeSchema = z.enum(["7d", "30d"]);
export type MemberUsageRange = z.infer<typeof memberUsageRangeSchema>;

export const memberUsageDetailPeriodSchema = z.union([periodSchema, memberUsageRangeSchema]);
export type MemberUsageDetailPeriod = z.infer<typeof memberUsageDetailPeriodSchema>;

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

export const syncWindowProviderSchema = z.object({
  provider: z.string().trim().min(1),
  since: isoDateSchema.optional(),
});

export type SyncWindowProvider = z.infer<typeof syncWindowProviderSchema>;

export const syncWindowsResponseSchema = z.object({
  serverTime: z.string().datetime(),
  until: isoDateSchema,
  providers: z.array(syncWindowProviderSchema),
});

export type SyncWindowsResponse = z.infer<typeof syncWindowsResponseSchema>;

export const leaderboardRowSchema = z.object({
  rank: z.number().int().positive(),
  username: z.string().trim().min(1).max(80),
  displayName: z.string().min(1).max(80),
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

export const memberUsageTrendPointSchema = z.object({
  date: isoDateSchema,
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageProviderBreakdownSchema = z.object({
  provider: providerSchema,
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageModelBreakdownSchema = z.object({
  modelName: z.string().trim().min(1).max(160),
  provider: providerSchema,
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageDeviceBreakdownSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  deviceName: z.string().trim().min(1).max(80),
  os: z.enum(["darwin", "linux", "win32"]),
  totalTokens: z.number().int().nonnegative().safe(),
  totalCostUsd: costUsdSchema,
});

export const memberUsageDetailSchema = z.object({
  member: z.object({
    username: z.string().trim().min(1).max(80),
    displayName: z.string().min(1).max(80),
  }),
  period: memberUsageDetailPeriodSchema,
  summary: z.object({
    rank: z.number().int().positive().nullable(),
    totalTokens: z.number().int().nonnegative().safe(),
    totalCostUsd: costUsdSchema,
  }),
  trend: z.array(memberUsageTrendPointSchema),
  providers: z.array(memberUsageProviderBreakdownSchema),
  models: z.array(memberUsageModelBreakdownSchema),
  devices: z.array(memberUsageDeviceBreakdownSchema),
});

export type MemberUsageDetail = z.infer<typeof memberUsageDetailSchema>;
