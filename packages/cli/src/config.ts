import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { z } from "zod";

export const configSchema = z.object({
  serverUrl: z.string().url(),
  token: z.string().min(1).optional(),
  deviceId: z.string().uuid().optional(),
  deviceName: z.string().trim().min(1).max(80).optional(),
  lastSync: z
    .object({
      ok: z.boolean(),
      message: z.string(),
      at: z.string().datetime(),
    })
    .optional(),
});

export type CliConfig = z.infer<typeof configSchema>;

type ConfigPathEnv = {
  HOME?: string;
  TOKEN_BURN_CONFIG_DIR?: string;
};

export function getConfigPath(env: ConfigPathEnv = process.env): string {
  if (env.TOKEN_BURN_CONFIG_DIR) {
    return join(env.TOKEN_BURN_CONFIG_DIR, "config.json");
  }

  return join(env.HOME ?? homedir(), ".config", "token-burn", "config.json");
}

export async function readConfig(configPath = getConfigPath()): Promise<CliConfig | null> {
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }

  return configSchema.parse(JSON.parse(raw));
}

export async function writeConfig(config: CliConfig, configPath = getConfigPath()): Promise<void> {
  const parsed = configSchema.parse(config);
  const configDir = dirname(configPath);

  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmodIfSupported(configDir, 0o700);
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await chmodIfSupported(configPath, 0o600);
}

export async function deleteConfig(configPath = getConfigPath()): Promise<void> {
  try {
    await rm(configPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function chmodIfSupported(targetPath: string, mode: number): Promise<void> {
  try {
    await chmod(targetPath, mode);
  } catch (error) {
    if (isNodeError(error) && (error.code === "ENOSYS" || error.code === "EINVAL" || error.code === "EPERM")) {
      return;
    }
    throw error;
  }
}
