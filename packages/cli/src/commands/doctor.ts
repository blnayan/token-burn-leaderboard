import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import type { SchedulerPlatform } from "../scheduler.js";
import {
  createTokenBurnServerClient,
  type CliHealth,
  type DeviceListResponse,
  type TokenBurnServerClient,
} from "../server-client.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createPlainRenderer } from "../ui/plain-renderer.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";
import { cliVersion } from "../version.js";

type DuplicateDeviceGroup = DeviceListResponse["duplicateGroups"][number];

export type DoctorDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  platform?: SchedulerPlatform;
  serverClient?: Pick<TokenBurnServerClient, "readHealth" | "listDevices">;
  log?: (message: string) => void;
  ui?: UiRenderer;
};

export type DoctorResult = {
  authenticated: boolean;
  cliVersion: string;
  device?: { id: string; name: string };
  duplicateDeviceGroups: DuplicateDeviceGroup[];
  deviceCheckError?: string;
  lastSync?: CliConfig["lastSync"];
  platform: SchedulerPlatform;
  rememberedServer?: string;
  serverHealthError?: string;
  serverUrl?: string;
};

export async function runDoctor({
  readConfig = readConfigFile,
  platform = process.platform,
  serverClient,
  log,
  ui,
}: DoctorDependencies = {}): Promise<DoctorResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  const config = await readConfig();

  if (!config) {
    const result = {
      authenticated: false,
      cliVersion,
      duplicateDeviceGroups: [],
      platform,
    };
    renderDoctor(result, renderer);
    return result;
  } else if (!config.token) {
    const result = {
      authenticated: false,
      cliVersion,
      duplicateDeviceGroups: [],
      ...(config.lastSync ? { lastSync: config.lastSync } : {}),
      platform,
      rememberedServer: config.serverUrl,
      serverUrl: config.serverUrl,
    };
    renderDoctor(result, renderer);
    return result;
  }

  let duplicateDeviceGroups: DuplicateDeviceGroup[] = [];
  let deviceCheckError: string | undefined;
  let serverHealthError: string | undefined;
  const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });

  try {
    const health: CliHealth = await client.readHealth();
    void health;
  } catch (error) {
    serverHealthError = error instanceof Error ? error.message : String(error);
  }

  try {
    const devices = await client.listDevices({ token: config.token });
    duplicateDeviceGroups = devices.duplicateGroups;
  } catch (error) {
    deviceCheckError = error instanceof Error ? error.message : String(error);
  }

  const result = {
    authenticated: true,
    cliVersion,
    ...(config.deviceId && config.deviceName ? { device: { id: config.deviceId, name: config.deviceName } } : {}),
    duplicateDeviceGroups,
    ...(deviceCheckError ? { deviceCheckError } : {}),
    ...(config.lastSync ? { lastSync: config.lastSync } : {}),
    platform,
    ...(serverHealthError ? { serverHealthError } : {}),
    serverUrl: config.serverUrl,
  };
  renderDoctor(result, renderer);
  return result;
}

export function renderDoctor(result: DoctorResult, ui: UiRenderer): void {
  ui.intro("Token Burn doctor", [
    { label: "CLI", value: result.cliVersion },
    { label: "Platform", value: result.platform },
  ]);

  if (result.serverUrl) ui.info(`Server: ${result.serverUrl}`);
  if (result.rememberedServer) ui.info(`Remembered server: ${result.rememberedServer}`);
  if (result.device) ui.info(`Device: ${result.device.name} (${result.device.id})`);
  if (result.lastSync) {
    ui.info(`Last sync: ${result.lastSync.ok ? "OK" : "Failed"} - ${result.lastSync.message} at ${result.lastSync.at}`);
  }
  if (result.serverHealthError) ui.warning("health", `Server health check failed: ${result.serverHealthError}`);
  if (result.deviceCheckError) ui.warning("devices", `Device check failed: ${result.deviceCheckError}`);
  if (result.duplicateDeviceGroups.length > 0) {
    ui.warning("devices", "Likely duplicate devices found. Run token-burn devices to inspect and merge.");
  }
  if (result.authenticated && result.serverUrl) ui.success("auth", `Authenticated with ${result.serverUrl}`);
  if (!result.authenticated) ui.warning("auth", "Not authenticated");
  ui.nextAction("Run token-burn sync to submit usage now.");
  ui.result({ ok: true, ...result });
}

export function createDoctorCommand(): Command {
  const command = new Command("doctor").description("Check Token Burn CLI setup").action(async () => {
    const flags = command.parent?.opts<OutputFlags>() ?? {};
    await runDoctor({ ui: createRenderer(resolveOutputMode({ flags })) });
  });

  return command;
}

function createLegacyLogRenderer(log: (message: string) => void): UiRenderer {
  return {
    ...createPlainRenderer({ write: (line) => log(formatLegacyLogLine(line)) }),
    result() {},
  };
}

function formatLegacyLogLine(line: string): string {
  if (line.startsWith("CLI: ")) return `CLI version: ${line.slice("CLI: ".length)}.`;
  if (line.startsWith("OK: ")) return withTrailingPeriod(line.slice("OK: ".length));
  if (line.startsWith("Warning: ")) return withTrailingPeriod(line.slice("Warning: ".length));
  if (line.startsWith("Next: ")) return line.slice("Next: ".length);
  if (
    line.startsWith("Device: ") ||
    line.startsWith("Last sync: ") ||
    line.startsWith("Platform: ") ||
    line.startsWith("Remembered server: ") ||
    line.startsWith("Server health check failed: ") ||
    line.startsWith("Device check failed: ")
  ) {
    return withTrailingPeriod(line);
  }

  return line;
}

function withTrailingPeriod(message: string): string {
  return message.endsWith(".") ? message : `${message}.`;
}
