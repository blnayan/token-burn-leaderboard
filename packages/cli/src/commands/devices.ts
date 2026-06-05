import { Command } from "commander";
import { z } from "zod";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { defaultServerUrl } from "../defaults.js";
import { postJson as postJsonRequest } from "../http.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createPlainRenderer } from "../ui/plain-renderer.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";

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

export type DeviceListResult = DeviceListResponse;
export type DeviceMergeResult = DeviceMergeResponse;

export type DevicesDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  getJson?: <T>(url: string, token?: string) => Promise<T>;
  postJson?: <T>(url: string, body: unknown, token?: string) => Promise<T>;
  log?: (message: string) => void;
  ui?: UiRenderer;
};

export async function runListDevices({
  readConfig = readConfigFile,
  getJson = getJsonRequest,
  log,
  ui,
}: DevicesDependencies = {}): Promise<DeviceListResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  const config = await requireAuthenticatedConfig(readConfig);
  const response = deviceListResponseSchema.parse(
    await getJson<DeviceListResponse>(`${normalizeServerUrl(config.serverUrl)}/api/cli/devices`, config.token),
  );

  if (response.devices.length === 0) {
    renderer.info("No devices found.");
  } else {
    renderer.table("Devices", {
      columns: ["ID", "Name", "OS", "Rows", "Tokens"],
      rows: response.devices.map((device) => [
        device.id,
        device.name,
        device.os,
        String(device.dailyRows),
        device.totalTokens,
      ]),
    });
  }

  if (response.duplicateGroups.length === 0) {
    renderer.info("No likely duplicate devices found.");
    renderer.result({ ok: true, ...response });
    return response;
  }

  renderer.table("Likely duplicates", {
    columns: ["Name", "OS", "Duplicates", "Conflicts"],
    rows: response.duplicateGroups.map((group) => [
      group.name,
      group.os,
      String(group.duplicateRows),
      String(group.conflictRows),
    ]),
  });

  for (const group of response.duplicateGroups) {
    if (group.conflictRows > 0) {
      renderer.info("Conflicts will be resolved automatically by keeping the higher provider/date total.");
    }

    if (group.devices.length >= 2) {
      const sortedDevices = [...group.devices].sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt));
      const source = sortedDevices[0];
      const target = sortedDevices[sortedDevices.length - 1];

      if (source && target && source.id !== target.id) {
        renderer.nextAction(`Merge suggestion: token-burn devices merge ${source.id} ${target.id}`);
      }
    }
  }

  renderer.result({ ok: true, ...response });
  return response;
}

export async function runMergeDevices({
  sourceDeviceId,
  targetDeviceId,
  readConfig = readConfigFile,
  postJson = postJsonRequest,
  log,
  ui,
}: DevicesDependencies & {
  sourceDeviceId: string;
  targetDeviceId: string;
}): Promise<DeviceMergeResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  const config = await requireAuthenticatedConfig(readConfig);
  const response = deviceMergeResponseSchema.parse(
    await postJson<DeviceMergeResponse>(
      `${normalizeServerUrl(config.serverUrl)}/api/cli/devices/merge`,
      { sourceDeviceId, targetDeviceId },
      config.token,
    ),
  );

  renderer.summary("Merge complete", [
    { label: "Merged", value: `${response.sourceDeviceId} into ${response.targetDeviceId}` },
    { label: "Deleted duplicate rows", value: String(response.deletedDuplicateRows) },
    { label: "Moved rows", value: String(response.movedRows) },
    { label: "Resolved conflict rows", value: String(response.resolvedConflictRows) },
    { label: "Deleted source device", value: response.deletedSourceDevice ? "yes" : "no" },
  ]);
  renderer.result({ ok: true, ...response });
  return response;
}

export function createDevicesCommand(): Command {
  const command = new Command("devices").description("List and merge Token Burn devices").action(async () => {
    const flags = command.parent?.opts<OutputFlags>() ?? {};
    await runListDevices({ ui: createRenderer(resolveOutputMode({ flags })) });
  });

  command
    .command("list")
    .description("List Token Burn devices")
    .action(async () => {
      const flags = command.parent?.opts<OutputFlags>() ?? {};
      await runListDevices({ ui: createRenderer(resolveOutputMode({ flags })) });
    });

  command
    .command("merge")
    .description("Merge a duplicate source device into a target device")
    .argument("<source-device-id>")
    .argument("<target-device-id>")
    .action(async (sourceDeviceId: string, targetDeviceId: string) => {
      const flags = command.parent?.opts<OutputFlags>() ?? {};
      await runMergeDevices({
        sourceDeviceId,
        targetDeviceId,
        ui: createRenderer(resolveOutputMode({ flags })),
      });
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

function createLegacyLogRenderer(log: (message: string) => void): UiRenderer {
  return {
    ...createPlainRenderer({ write: log }),
    result() {},
  };
}
