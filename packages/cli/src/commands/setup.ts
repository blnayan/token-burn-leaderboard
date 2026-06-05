import { Command } from "commander";
import { z } from "zod";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { defaultServerUrl } from "../defaults.js";
import { getJson, HttpError } from "../http.js";
import { syncUsage } from "../sync.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createPlainRenderer } from "../ui/plain-renderer.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
import { runLogin } from "./login.js";
import { runInstallScheduler } from "./scheduler.js";

type SetupLogin = (options: { serverUrl: string; ui?: UiRenderer }) => Promise<unknown>;
type SetupInstallScheduler = (options: { dryRun: boolean; ui?: UiRenderer }) => Promise<unknown>;
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
  ui?: UiRenderer;
};

export type SetupResult = {
  authReused: boolean;
  schedulerInstalled: boolean;
  syncFailed: boolean;
};

export async function runSetup({
  serverUrl,
  readConfig = readConfigFile,
  login = runLogin,
  sync = syncUsage,
  installScheduler = runInstallScheduler,
  validateAuth = validateAuthFromServer,
  log,
  ui,
}: SetupOptions): Promise<SetupResult> {
  const renderer = ui ?? (log ? createPlainRenderer({ write: log }) : createRenderer(resolveOutputMode({ flags: {} })));
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  renderer.intro("Token Burn setup", [{ label: "Server", value: normalizedServerUrl }]);
  renderer.step("auth", "Checking authentication");

  const authReused = await canReuseExistingAuth({ serverUrl: normalizedServerUrl, readConfig, validateAuth });
  if (authReused) {
    renderer.success("auth", "Existing authentication is valid");
  } else {
    await login(login === runLogin ? { serverUrl: normalizedServerUrl, ui: renderer } : { serverUrl: normalizedServerUrl });
  }

  let syncFailed = false;
  renderer.step("sync", "Submitting usage totals");
  try {
    await sync();
    renderer.success("sync", "First sync complete");
  } catch (error) {
    syncFailed = true;
    renderer.warning("sync", `First sync failed: ${formatErrorMessage(error)}`);
  }

  renderer.step("scheduler", "Installing automatic sync");
  try {
    await installScheduler(installScheduler === runInstallScheduler ? { dryRun: false, ui: renderer } : { dryRun: false });
  } catch (error) {
    throw new Error(
      `Setup authenticated and attempted the first sync, but automatic sync was not installed: ${formatErrorMessage(
        error,
      )}. Retry with npx @blnayan/token-burn@latest install-scheduler.`,
    );
  }

  if (syncFailed) {
    renderer.info("Automatic sync was still installed or refreshed and will retry on quarter-hour boundaries.");
  }

  const result = { authReused, schedulerInstalled: true, syncFailed };
  renderer.success("scheduler", "Automatic sync will run on quarter-hour boundaries");
  renderer.summary("Setup complete", [{ label: "Automatic sync", value: "Quarter-hour boundaries" }]);
  renderer.result({ ok: true, ...result });
  return result;
}

export function createSetupCommand(): Command {
  const command = new Command("setup")
    .description("Authenticate, sync once, and install automatic Token Burn sync")
    .option("-s, --server-url <url>", "Token Burn server URL")
    .option("--server <url>", "Alias for --server-url")
    .action(async (options: { serverUrl?: string; server?: string }) => {
      const flags = command.parent?.opts<OutputFlags>() ?? {};
      await runSetup({
        serverUrl: options.serverUrl ?? options.server ?? defaultServerUrl(),
        ui: createRenderer(resolveOutputMode({ flags })),
      });
    });

  return command;
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
