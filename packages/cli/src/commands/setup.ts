import { Command } from "commander";
import { z } from "zod";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { defaultServerUrl } from "../defaults.js";
import { getJson, HttpError } from "../http.js";
import { syncUsage } from "../sync.js";
import { runLogin } from "./login.js";
import { runInstallScheduler } from "./scheduler.js";

type SetupLogin = (options: { serverUrl: string }) => Promise<void>;
type SetupInstallScheduler = (options: { dryRun: boolean }) => Promise<void>;
type SetupSync = () => Promise<unknown>;
type SetupValidateAuth = (options: { serverUrl: string; token: string }) => Promise<boolean>;

const authValidationResponseSchema = z.object({
  authenticated: z.literal(true),
  member: z.object({
    displayName: z.string().min(1),
    username: z.string().min(1).optional(),
  }),
});

export type SetupOptions = {
  serverUrl: string;
  readConfig?: () => Promise<CliConfig | null>;
  login?: SetupLogin;
  sync?: SetupSync;
  installScheduler?: SetupInstallScheduler;
  validateAuth?: SetupValidateAuth;
  log?: (message: string) => void;
};

export async function runSetup({
  serverUrl,
  readConfig = readConfigFile,
  login = runLogin,
  sync = syncUsage,
  installScheduler = runInstallScheduler,
  validateAuth = validateAuthFromServer,
  log = console.log,
}: SetupOptions): Promise<void> {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  log("Starting Token Burn setup.");

  if (await canReuseExistingAuth({ serverUrl: normalizedServerUrl, readConfig, validateAuth })) {
    log("Existing authentication is valid.");
  } else {
    await login({ serverUrl: normalizedServerUrl });
    log("Login complete.");
  }

  let syncFailed = false;
  try {
    await sync();
    log("First sync complete.");
  } catch (error) {
    syncFailed = true;
    log(`First sync failed: ${formatErrorMessage(error)}`);
  }

  try {
    await installScheduler({ dryRun: false });
  } catch (error) {
    throw new Error(
      `Setup authenticated and attempted the first sync, but automatic sync was not installed: ${formatErrorMessage(
        error,
      )}. Retry with npx @blnayan/token-burn@latest install-scheduler.`,
    );
  }

  if (syncFailed) {
    log("Automatic sync was still installed or refreshed and will retry on quarter-hour boundaries.");
  }

  log("Setup complete. Automatic sync will run on quarter-hour boundaries.");
}

export function createSetupCommand(): Command {
  return new Command("setup")
    .description("Authenticate, sync once, and install automatic Token Burn sync")
    .option("-s, --server-url <url>", "Token Burn server URL")
    .option("--server <url>", "Alias for --server-url")
    .action(async (options: { serverUrl?: string; server?: string }) => {
      await runSetup({ serverUrl: options.serverUrl ?? options.server ?? defaultServerUrl() });
    });
}

async function canReuseExistingAuth({
  serverUrl,
  readConfig,
  validateAuth,
}: {
  serverUrl: string;
  readConfig: () => Promise<CliConfig | null>;
  validateAuth: SetupValidateAuth;
}): Promise<boolean> {
  const config = await readConfig();
  if (!config?.token) return false;
  if (normalizeServerUrl(config.serverUrl) !== serverUrl) return false;

  return validateAuth({ serverUrl, token: config.token });
}

async function validateAuthFromServer({
  serverUrl,
  token,
}: {
  serverUrl: string;
  token: string;
}): Promise<boolean> {
  try {
    authValidationResponseSchema.parse(await getJson(`${serverUrl}/api/cli/auth`, token));
    return true;
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return false;
    throw error;
  }
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
