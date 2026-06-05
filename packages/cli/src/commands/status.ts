import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { resolveOutputMode } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
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
  ui?: UiRenderer;
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
  ui = createRenderer(resolveOutputMode({ flags: {} })),
}: StatusDependencies = {}): Promise<StatusResult> {
  const config = await readConfig();

  if (!config) {
    const result = { authenticated: false, cliVersion };
    renderStatus(result, ui);
    return result;
  }

  if (!config.token) {
    const result = {
      authenticated: false,
      cliVersion,
      ...(config.lastSync ? { lastSync: config.lastSync } : {}),
      rememberedServer: config.serverUrl,
      serverUrl: config.serverUrl,
    };
    renderStatus(result, ui);
    return result;
  }

  let requiredCliVersion: string | undefined;
  let serverHealthError: string | undefined;

  if (config.token) {
    try {
      const health = await readHealth(config.serverUrl);
      requiredCliVersion = health.requiredCliVersion;
    } catch (error) {
      serverHealthError = error instanceof Error ? error.message : String(error);
    }
  }

  const result = {
    authenticated: true,
    cliVersion,
    ...(config.deviceId && config.deviceName ? { device: { id: config.deviceId, name: config.deviceName } } : {}),
    ...(config.lastSync ? { lastSync: config.lastSync } : {}),
    ...(requiredCliVersion ? { requiredCliVersion } : {}),
    ...(serverHealthError ? { serverHealthError } : {}),
    serverUrl: config.serverUrl,
  };
  renderStatus(result, ui);
  return result;
}

export function renderStatus(result: StatusResult, ui: UiRenderer): void {
  ui.intro("Token Burn status", [
    { label: "CLI", value: result.cliVersion },
    { label: "Auth", value: result.authenticated ? "authenticated" : "not authenticated" },
  ]);

  if (result.serverUrl) ui.info(`Server: ${result.serverUrl}`);
  if (result.rememberedServer) ui.info(`Remembered server: ${result.rememberedServer}`);
  if (result.device) ui.info(`Device: ${result.device.name} (${result.device.id})`);
  if (result.lastSync) {
    ui.info(`Last sync: ${result.lastSync.ok ? "OK" : "Failed"} - ${result.lastSync.message} at ${result.lastSync.at}`);
  }
  if (result.serverHealthError) ui.warning("health", `Server health check failed: ${result.serverHealthError}`);
  if (result.requiredCliVersion && result.requiredCliVersion !== result.cliVersion) {
    ui.warning("version", formatRequiredCliVersionError(result.cliVersion, result.requiredCliVersion));
  }
  if (result.authenticated && result.serverUrl) ui.success("auth", `Authenticated with ${result.serverUrl}`);
  if (!result.authenticated) ui.warning("auth", "Not authenticated");
  ui.result({ ok: true, ...result });
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
