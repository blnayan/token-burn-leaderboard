import { z } from "zod";

const envSchema = z.object({
  ADMIN_GITHUB_LOGIN: z.string().min(1),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  TOKEN_BURN_PUBLIC_URL: z.string().url(),
  TOKEN_BURN_TIMEZONE: z.literal("UTC").default("UTC"),
});

export const env = envSchema.parse(process.env);
