import { Command } from "commander";
import { z } from "zod";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { defaultServerUrl } from "../defaults.js";
import { postJson as postJsonRequest } from "../http.js";

const deviceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  os: z.string().min(1),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  dailyRows: z.number().int().nonnegative(),
  totalTokens: z.string().regex(/^\d+$/),
});

const duplicateGroupSchema = z.object({
  name: z.string().min(1),
  os: z.string().min(1),
  duplicateRows: z.number().int().nonnegative(),
  conflictRows: z.number().int().nonnegative(),
  devices: z.array(deviceSummarySchema),
});

const deviceListResponseSchema = z.object({
  devices: z.array(deviceSummarySchema),
  duplicateGroups: z.array(duplicateGroupSchema),
});

const deviceMergeResponseSchema = z.object({
  sourceDeviceId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  deletedDuplicateRows: z.number().int().nonnegative(),
  movedRows: z.number().int().nonnegative(),
  resolvedConflictRows: z.number().int().nonnegative(),
  deletedSourceDevice: z.boolean(),
});

type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;
type DeviceMergeResponse = z.infer<typeof deviceMergeResponseSchema>;

export type DevicesDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  getJson?: <T>(url: string, token?: string) => Promise<T>;
  postJson?: <T>(url: string, body: unknown, token?: string) => Promise<T>;
  log?: (message: string) => void;
};

export async function runListDevices({
  readConfig = readConfigFile,
  getJson = getJsonRequest,
  log = console.log,
}: DevicesDependencies = {}): Promise<void> {
  const config = await requireAuthenticatedConfig(readConfig);
  const response = deviceListResponseSchema.parse(
    await getJson<DeviceListResponse>(`${normalizeServerUrl(config.serverUrl)}/api/cli/devices`, config.token),
  );

  log("Devices:");
  if (response.devices.length === 0) {
    log("No devices found.");
  }

  for (const device of response.devices) {
    log(`${device.id}  ${device.name}  ${device.os}  ${device.dailyRows} rows  ${device.totalTokens} tokens`);
  }

  if (response.duplicateGroups.length === 0) {
    log("No likely duplicate devices found.");
    return;
  }

  log("Likely duplicates:");
  for (const group of response.duplicateGroups) {
    log(`${group.name} / ${group.os}: ${group.duplicateRows} duplicate rows, ${group.conflictRows} conflicts`);

    if (group.conflictRows > 0) {
      log("Conflicts will be resolved automatically by keeping the higher provider/date total.");
    }

    if (group.devices.length >= 2) {
      const sortedDevices = [...group.devices].sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt));
      const source = sortedDevices[0];
      const target = sortedDevices[sortedDevices.length - 1];

      if (source && target && source.id !== target.id) {
        log(`Merge suggestion: token-burn devices merge ${source.id} ${target.id}`);
      }
    }
  }
}

export async function runMergeDevices({
  sourceDeviceId,
  targetDeviceId,
  readConfig = readConfigFile,
  postJson = postJsonRequest,
  log = console.log,
}: DevicesDependencies & {
  sourceDeviceId: string;
  targetDeviceId: string;
}): Promise<void> {
  const config = await requireAuthenticatedConfig(readConfig);
  const response = deviceMergeResponseSchema.parse(
    await postJson<DeviceMergeResponse>(
      `${normalizeServerUrl(config.serverUrl)}/api/cli/devices/merge`,
      { sourceDeviceId, targetDeviceId },
      config.token,
    ),
  );

  log(`Merged ${response.sourceDeviceId} into ${response.targetDeviceId}.`);
  log(`Deleted duplicate rows: ${response.deletedDuplicateRows}`);
  log(`Moved rows: ${response.movedRows}`);
  log(`Resolved conflict rows: ${response.resolvedConflictRows}`);
  log(`Deleted source device: ${response.deletedSourceDevice ? "yes" : "no"}`);
}

export function createDevicesCommand(): Command {
  const command = new Command("devices").description("List and merge Token Burn devices").action(async () => {
    await runListDevices();
  });

  command
    .command("merge")
    .description("Merge a duplicate source device into a target device")
    .argument("<source-device-id>")
    .argument("<target-device-id>")
    .action(async (sourceDeviceId: string, targetDeviceId: string) => {
      await runMergeDevices({ sourceDeviceId, targetDeviceId });
    });

  return command;
}

async function requireAuthenticatedConfig(readConfig: () => Promise<CliConfig | null>): Promise<CliConfig & { token: string }> {
  const config = await readConfig();

  if (!config?.token) {
    const serverUrl = config?.serverUrl ?? defaultServerUrl();
    throw new Error(`Run token-burn login --server-url ${serverUrl} to authenticate.`);
  }

  return config as CliConfig & { token: string };
}

async function getJsonRequest<T>(url: string, token?: string): Promise<T> {
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

  return data as T;
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
