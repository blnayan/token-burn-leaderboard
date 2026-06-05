import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { cliVersion } from "../version.js";

type CliHealth = {
  requiredCliVersion: string;
  serverTime: string;
};

type HealthReader = (serverUrl: string) => Promise<CliHealth>;

export type StatusDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  readHealth?: HealthReader;
  log?: (message: string) => void;
};

export type StatusResult = {
  authenticated: boolean;
  cliVersion: string;
  device?: { id: string; name: string };
  lastSync?: CliConfig["lastSync"];
  rememberedServer?: string;
  requiredCliVersion?: string;
  serverHealthError?: string;
  serverUrl?: string;
};

export async function runStatus({
  readConfig = readConfigFile,
  readHealth = readHealthFromServer,
  log = console.log,
}: StatusDependencies = {}): Promise<StatusResult> {
  log(`CLI version: ${cliVersion}.`);

  const config = await readConfig();

  if (!config) {
    log("Not authenticated.");
    return { authenticated: false, cliVersion };
  }

  if (!config.token) {
    log("Not authenticated.");
    log(`Remembered server: ${config.serverUrl}.`);
    if (config.lastSync) {
      log(`Last sync: ${config.lastSync.ok ? "OK" : "Failed"} - ${config.lastSync.message} at ${config.lastSync.at}.`);
    }
    return {
      authenticated: false,
      cliVersion,
      ...(config.lastSync ? { lastSync: config.lastSync } : {}),
      rememberedServer: config.serverUrl,
      serverUrl: config.serverUrl,
    };
  } else {
    log(`Authenticated with ${config.serverUrl}.`);

    if (config.deviceId && config.deviceName) {
      log(`Device: ${config.deviceName} (${config.deviceId}).`);
    }
  }

  if (config.lastSync) {
    log(`Last sync: ${config.lastSync.ok ? "OK" : "Failed"} - ${config.lastSync.message} at ${config.lastSync.at}.`);
  }

  let requiredCliVersion: string | undefined;
  let serverHealthError: string | undefined;

  if (config.token) {
    try {
      const health = await readHealth(config.serverUrl);
      requiredCliVersion = health.requiredCliVersion;

      if (cliVersion !== health.requiredCliVersion) {
        log(formatRequiredCliVersionError(cliVersion, health.requiredCliVersion));
      }
    } catch (error) {
      serverHealthError = error instanceof Error ? error.message : String(error);
      log(`Server health check failed: ${serverHealthError}.`);
    }
  }

  return {
    authenticated: true,
    cliVersion,
    ...(config.deviceId && config.deviceName ? { device: { id: config.deviceId, name: config.deviceName } } : {}),
    ...(config.lastSync ? { lastSync: config.lastSync } : {}),
    ...(requiredCliVersion ? { requiredCliVersion } : {}),
    ...(serverHealthError ? { serverHealthError } : {}),
    serverUrl: config.serverUrl,
  };
}

export function createStatusCommand(): Command {
  return new Command("status").description("Show Token Burn CLI authentication status").action(async () => {
    await runStatus();
  });
}

async function readHealthFromServer(serverUrl: string): Promise<CliHealth> {
  const normalizedServerUrl = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${normalizedServerUrl}/api/cli/health`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body: unknown = await response.json();

  if (!isRecord(body)) {
    throw new Error("Invalid health response");
  }

  const { requiredCliVersion, serverTime } = body;

  if (
    typeof requiredCliVersion !== "string" ||
    typeof serverTime !== "string"
  ) {
    throw new Error("Invalid health response");
  }

  return { requiredCliVersion, serverTime };
}

function formatRequiredCliVersionError(actualVersion: string, requiredVersion: string): string {
  return `Token Burn requires token-burn ${requiredVersion}. You have ${actualVersion}. Run npm install -g @blnayan/token-burn@latest.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
