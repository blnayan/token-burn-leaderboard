import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { cliVersion } from "../version.js";

type CliHealth = {
  recommendedCliVersion: string;
  minimumCliVersion: string;
  serverTime: string;
};

type HealthReader = (serverUrl: string) => Promise<CliHealth>;

export type StatusDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  readHealth?: HealthReader;
  log?: (message: string) => void;
};

export async function runStatus({
  readConfig = readConfigFile,
  readHealth = readHealthFromServer,
  log = console.log,
}: StatusDependencies = {}): Promise<void> {
  log(`CLI version: ${cliVersion}.`);

  const config = await readConfig();

  if (!config) {
    log("Not authenticated.");
    return;
  }

  if (!config.token) {
    log("Not authenticated.");
    log(`Remembered server: ${config.serverUrl}.`);
  } else {
    log(`Authenticated with ${config.serverUrl}.`);

    if (config.deviceId && config.deviceName) {
      log(`Device: ${config.deviceName} (${config.deviceId}).`);
    }
  }

  if (config.lastSync) {
    log(`Last sync: ${config.lastSync.ok ? "OK" : "Failed"} - ${config.lastSync.message} at ${config.lastSync.at}.`);
  }

  if (config.token) {
    try {
      const health = await readHealth(config.serverUrl);

      if (isVersionLessThan(cliVersion, health.recommendedCliVersion)) {
        log(
          `Update available: token-burn ${cliVersion} -> ${health.recommendedCliVersion}. Run npm install -g @blnayan/token-burn@latest.`,
        );
      }
    } catch (error) {
      log(`Server health check failed: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }
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

  const { recommendedCliVersion, minimumCliVersion, serverTime } = body;

  if (
    typeof recommendedCliVersion !== "string" ||
    typeof minimumCliVersion !== "string" ||
    typeof serverTime !== "string"
  ) {
    throw new Error("Invalid health response");
  }

  return { recommendedCliVersion, minimumCliVersion, serverTime };
}

function isVersionLessThan(left: string, right: string): boolean {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);

  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart < rightPart) return true;
    if (leftPart > rightPart) return false;
  }

  return false;
}

function parseVersionParts(version: string): [number, number, number] {
  const parts = version.split(".").slice(0, 3).map(Number);

  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
