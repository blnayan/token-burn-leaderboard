import { Command } from "commander";

import { defaultServerUrl } from "../defaults.js";
import { syncUsage } from "../sync.js";
import { runLogin } from "./login.js";
import { runInstallScheduler } from "./scheduler.js";

type SetupLogin = (options: { serverUrl: string }) => Promise<void>;
type SetupInstallScheduler = (options: { dryRun: boolean }) => Promise<void>;

export type SetupOptions = {
  serverUrl: string;
  login?: SetupLogin;
  sync?: () => Promise<void>;
  installScheduler?: SetupInstallScheduler;
  log?: (message: string) => void;
};

export async function runSetup({
  serverUrl,
  login = runLogin,
  sync = syncUsage,
  installScheduler = runInstallScheduler,
  log = console.log,
}: SetupOptions): Promise<void> {
  log("Starting Token Burn setup.");
  await login({ serverUrl });
  log("Login complete.");

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
    log("Automatic sync was still installed and will retry every 15 minutes.");
  }

  log("Setup complete. Automatic sync will run every 15 minutes.");
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

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
