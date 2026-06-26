import { randomUUID } from "node:crypto";
import { hostname, platform as readPlatform } from "node:os";

import type { CliConfig } from "./config.js";
import { readConfig as readConfigFile, writeConfig as writeConfigFile } from "./config.js";
import { defaultServerUrl } from "./defaults.js";
import { createTokenBurnServerClient, type TokenBurnServerClient } from "./server-client.js";
import {
  collectAndSubmitUsage as collectAndSubmitUsageFromProviders,
  type SyncCollectionIssue,
  type SyncCollectionResult,
} from "./sync-collection.js";
import { cliVersion as packageCliVersion } from "./version.js";

type SyncPlatform = Extract<NodeJS.Platform, "darwin" | "linux" | "win32">;

export type SyncDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  serverClient?: Pick<TokenBurnServerClient, "readHealth" | "readSyncWindows" | "submitSyncPayload">;
  collectAndSubmitUsage?: typeof collectAndSubmitUsageFromProviders;
  now?: () => Date;
  platform?: SyncPlatform;
  cliVersion?: string;
  createDeviceId?: () => string;
  readDeviceName?: () => string;
  log?: (message: string) => void;
};

export type SyncProviderIssue = SyncCollectionIssue;

export type SyncResult = {
  failedProviders: SyncProviderIssue[];
  lastSync: NonNullable<CliConfig["lastSync"]>;
  skippedProviders: SyncProviderIssue[];
  submitted: number;
  syncedAt: string;
};

export async function syncUsage({
  readConfig = readConfigFile,
  writeConfig = writeConfigFile,
  serverClient,
  collectAndSubmitUsage = collectAndSubmitUsageFromProviders,
  now = () => new Date(),
  platform = normalizePlatform(readPlatform()),
  cliVersion,
  createDeviceId = randomUUID,
  readDeviceName = hostname,
  log = console.log,
}: SyncDependencies = {}): Promise<SyncResult> {
  const config = await readConfig();

  if (!config?.token) {
    const serverUrl = config?.serverUrl ?? defaultServerUrl();
    throw new Error(`Run token-burn login --server-url ${serverUrl} to authenticate.`);
  }

  const client = serverClient ?? createTokenBurnServerClient({ serverUrl: config.serverUrl });
  const syncedAt = now().toISOString();
  const version = cliVersion ?? packageCliVersion;
  const health = await client.readHealth();
  ensureRequiredCliVersion(version, health.requiredCliVersion);

  const deviceId = config.deviceId ?? createDeviceId();
  const deviceName = normalizeDeviceName(readDeviceName());
  const configWithDevice = { ...config, deviceId, deviceName };
  await writeConfig(configWithDevice);

  let collection: SyncCollectionResult;

  try {
    const syncWindows = await client.readSyncWindows({ token: config.token, deviceId });
    collection = await collectAndSubmitUsage({
      token: config.token,
      deviceId,
      deviceName,
      cliVersion: version,
      platform,
      syncedAt,
      syncWindows,
      serverClient: client,
    });
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    const lastSync = {
      ok: false,
      message: `Submitted 0 usage rows. Failed before provider collection: ${trimTrailingPeriod(normalizedError.message)}.`,
      at: syncedAt,
    } satisfies NonNullable<CliConfig["lastSync"]>;
    await writeConfig({ ...configWithDevice, lastSync });
    throw normalizedError;
  }

  const message = formatSyncMessage(collection.submitted, collection.failedProviders, collection.skippedProviders);
  const lastSync = {
    ok: collection.failedProviders.length === 0,
    message,
    at: syncedAt,
  };

  await writeConfig({ ...configWithDevice, lastSync });

  if (collection.submitted === 0 && collection.failedProviders.length > 0) {
    throw new Error(`All supported providers failed: ${formatFailures(collection.failedProviders)}.`);
  }

  log(message);

  return {
    failedProviders: collection.failedProviders,
    lastSync,
    skippedProviders: collection.skippedProviders,
    submitted: collection.submitted,
    syncedAt,
  };
}

function normalizeDeviceName(value: string): string {
  const trimmed = value.trim();
  return trimmed || "Unknown device";
}

function ensureRequiredCliVersion(actualVersion: string, requiredVersion: string): void {
  if (actualVersion === requiredVersion) return;

  throw new Error(
    `Token Burn requires token-burn ${requiredVersion}. You have ${actualVersion}. Run npm install -g @blnayan/token-burn@latest.`,
  );
}

function normalizePlatform(value: NodeJS.Platform): SyncPlatform {
  if (value === "darwin" || value === "linux" || value === "win32") {
    return value;
  }

  throw new Error(`Unsupported platform for sync: ${value}.`);
}

function formatSyncMessage(submitted: number, failures: SyncProviderIssue[], skipped: SyncProviderIssue[]): string {
  const parts = [`Submitted ${submitted} usage ${submitted === 1 ? "row" : "rows"}`];

  if (failures.length > 0) {
    parts.push(`Failed providers: ${formatFailures(failures)}`);
  }

  if (skipped.length > 0) {
    parts.push(`Skipped providers: ${formatFailures(skipped)}`);
  }

  return `${parts.join(". ")}.`;
}

function formatFailures(failures: SyncProviderIssue[]): string {
  return failures.map(({ provider, message }) => `${provider}: ${trimTrailingPeriod(message)}`).join("; ");
}

function trimTrailingPeriod(message: string): string {
  return message.replace(/\.$/, "");
}
