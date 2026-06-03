import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import type { SchedulerPlatform } from "../scheduler.js";
import { cliVersion } from "../version.js";

type CliHealth = {
  recommendedCliVersion: string;
  minimumCliVersion: string;
  serverTime: string;
};

type DuplicateDeviceGroup = {
  name: string;
  os: string;
  duplicateRows: number;
  conflictRows: number;
};

type DeviceList = {
  duplicateGroups: DuplicateDeviceGroup[];
};

export type DoctorDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  platform?: SchedulerPlatform;
  readHealth?: (serverUrl: string) => Promise<CliHealth>;
  readDevices?: (serverUrl: string, token: string) => Promise<DeviceList>;
  log?: (message: string) => void;
};

export async function runDoctor({
  readConfig = readConfigFile,
  platform = process.platform,
  readHealth = readHealthFromServer,
  readDevices = readDevicesFromServer,
  log = console.log,
}: DoctorDependencies = {}): Promise<void> {
  log(`CLI version: ${cliVersion}.`);

  const config = await readConfig();

  if (!config) {
    log("Not authenticated.");
  } else if (!config.token) {
    log("Not authenticated.");
    log(`Remembered server: ${config.serverUrl}.`);
  } else {
    log(`Authenticated with ${config.serverUrl}.`);

    if (config.deviceId && config.deviceName) {
      log(`Device: ${config.deviceName} (${config.deviceId}).`);
    }
  }

  if (config?.lastSync) {
    log(`Last sync: ${config.lastSync.ok ? "OK" : "Failed"} - ${config.lastSync.message} at ${config.lastSync.at}.`);
  }

  if (config?.token) {
    try {
      await readHealth(config.serverUrl);
    } catch (error) {
      log(`Server health check failed: ${error instanceof Error ? error.message : String(error)}.`);
    }

    try {
      const devices = await readDevices(config.serverUrl, config.token);

      if (devices.duplicateGroups.length > 0) {
        log("Likely duplicate devices found. Run token-burn devices to inspect and merge.");
      }
    } catch (error) {
      log(`Device check failed: ${error instanceof Error ? error.message : String(error)}.`);
    }
  }

  log(`Platform: ${platform}.`);
  log("Run token-burn sync to submit usage now.");
}

export function createDoctorCommand(): Command {
  return new Command("doctor").description("Check Token Burn CLI setup").action(async () => {
    await runDoctor();
  });
}

async function readHealthFromServer(serverUrl: string): Promise<CliHealth> {
  const body = await getJson(`${normalizeServerUrl(serverUrl)}/api/cli/health`);

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

async function readDevicesFromServer(serverUrl: string, token: string): Promise<DeviceList> {
  const body = await getJson(`${normalizeServerUrl(serverUrl)}/api/cli/devices`, token);

  if (!isRecord(body) || !Array.isArray(body.duplicateGroups)) {
    throw new Error("Invalid devices response");
  }

  const duplicateGroups = body.duplicateGroups.map((group) => {
    if (!isRecord(group)) {
      throw new Error("Invalid devices response");
    }

    const { name, os, duplicateRows, conflictRows } = group;

    if (
      typeof name !== "string" ||
      typeof os !== "string" ||
      typeof duplicateRows !== "number" ||
      typeof conflictRows !== "number"
    ) {
      throw new Error("Invalid devices response");
    }

    return { name, os, duplicateRows, conflictRows };
  });

  return { duplicateGroups };
}

async function getJson(url: string, token?: string): Promise<unknown> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });

  const text = await response.text();
  const data = parseJsonOrNull(text);

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new Error(message);
  }

  if (text && data === null) {
    throw new Error("Expected JSON response.");
  }

  return data;
}

function parseJsonOrNull(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
