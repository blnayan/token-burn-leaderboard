import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile } from "../config.js";
import { defaultServerUrl } from "../defaults.js";
import {
  createTokenBurnServerClient,
  type DeviceListResponse as DeviceListResult,
  type DeviceMergeResponse as DeviceMergeResult,
  type TokenBurnServerClient,
} from "../server-client.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createPlainRenderer } from "../ui/plain-renderer.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";

export type { DeviceListResponse as DeviceListResult, DeviceMergeResponse as DeviceMergeResult } from "../server-client.js";

export type DevicesDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  serverClient?: Pick<TokenBurnServerClient, "listDevices" | "mergeDevices">;
  log?: (message: string) => void;
  ui?: UiRenderer;
};

export async function runListDevices({
  readConfig = readConfigFile,
  serverClient,
  log,
  ui,
}: DevicesDependencies = {}): Promise<DeviceListResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  const config = await requireAuthenticatedConfig(readConfig);
  const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
  const response = await client.listDevices({ token: config.token });

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
  serverClient,
  log,
  ui,
}: DevicesDependencies & {
  sourceDeviceId: string;
  targetDeviceId: string;
}): Promise<DeviceMergeResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  const config = await requireAuthenticatedConfig(readConfig);
  const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
  const response = await client.mergeDevices({ token: config.token, sourceDeviceId, targetDeviceId });

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

function createLegacyLogRenderer(log: (message: string) => void): UiRenderer {
  return {
    ...createPlainRenderer({ write: log }),
    result() {},
  };
}
