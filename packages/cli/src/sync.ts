import { randomUUID } from "node:crypto";
import { hostname, platform as readPlatform } from "node:os";

import { syncPayloadSchema, type Provider, type SyncPayload, type SyncWindowsResponse } from "@token-burn/shared";

import type { NormalizedUsageRow, ProviderUsageWindow } from "./ccusage.js";
import {
  isUnsupportedCcusageProviderError,
  readCcusageVersion as readCcusageVersionFromPackage,
  readProviderUsage as readProviderUsageFromCcusage,
} from "./ccusage.js";
import type { CliConfig } from "./config.js";
import { readConfig as readConfigFile, writeConfig as writeConfigFile } from "./config.js";
import { defaultServerUrl } from "./defaults.js";
import { createTokenBurnServerClient, type TokenBurnServerClient } from "./server-client.js";
import { cliVersion as packageCliVersion } from "./version.js";

type SyncPlatform = Extract<NodeJS.Platform, "darwin" | "linux" | "win32">;

export type SyncDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  serverClient?: Pick<TokenBurnServerClient, "readHealth" | "readSyncWindows" | "submitSyncPayload">;
  readProviderUsage?: (provider: Provider, options?: { window?: ProviderUsageWindow }) => Promise<NormalizedUsageRow[]>;
  readCcusageVersion?: () => Promise<string>;
  now?: () => Date;
  platform?: SyncPlatform;
  cliVersion?: string;
  createDeviceId?: () => string;
  readDeviceName?: () => string;
  log?: (message: string) => void;
};

export type SyncProviderIssue = {
  provider: Provider;
  message: string;
};

export type SyncResult = {
  failedProviders: SyncProviderIssue[];
  lastSync: NonNullable<CliConfig["lastSync"]>;
  skippedProviders: SyncProviderIssue[];
  submitted: number;
  syncedAt: string;
};

const providers: Provider[] = ["claude_code", "codex"];

export async function syncUsage({
  readConfig = readConfigFile,
  writeConfig = writeConfigFile,
  serverClient,
  readProviderUsage = readProviderUsageFromCcusage,
  readCcusageVersion = readCcusageVersionFromPackage,
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

  let ccusageVersion: string;
  let syncWindows: SyncWindowsResponse;

  try {
    ccusageVersion = await readCcusageVersion();
    syncWindows = await client.readSyncWindows({ token: config.token, deviceId });
  } catch (error) {
    const normalizedError = normalizeProviderError(error);
    const lastSync = {
      ok: false,
      message: `Submitted 0 usage rows. Failed before provider collection: ${trimTrailingPeriod(normalizedError.message)}.`,
      at: syncedAt,
    } satisfies NonNullable<CliConfig["lastSync"]>;
    await writeConfig({ ...configWithDevice, lastSync });
    throw normalizedError;
  }

  const providerWindows = new Map(syncWindows.providers.map((window) => [window.provider, window]));
  const failures: Array<{ provider: Provider; error: Error }> = [];
  const skipped: Array<{ provider: Provider; error: Error }> = [];
  let submitted = 0;

  for (const provider of providers) {
    try {
      const providerWindow = providerWindows.get(provider);
      const rows = await readProviderUsage(provider, {
        window: providerWindow?.since ? { since: providerWindow.since, until: syncWindows.until } : undefined,
      });

      for (const row of rows) {
        const payload = buildPayload(row, { cliVersion: version, ccusageVersion, deviceId, deviceName, platform, syncedAt });
        await client.submitSyncPayload({ token: config.token, payload });
        submitted += 1;
      }
    } catch (error) {
      const normalizedError = normalizeProviderError(error);

      if (isSkippableProviderError(error)) {
        skipped.push({ provider, error: normalizedError });
      } else {
        failures.push({ provider, error: normalizedError });
      }
    }
  }

  const message = formatSyncMessage(submitted, failures, skipped);
  const lastSync = {
    ok: failures.length === 0,
    message,
    at: syncedAt,
  };

  await writeConfig({ ...configWithDevice, lastSync });

  if (submitted === 0 && failures.length > 0) {
    throw new Error(`All supported providers failed: ${formatFailures(failures)}.`);
  }

  log(message);

  return {
    failedProviders: failures.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
    lastSync,
    skippedProviders: skipped.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
    submitted,
    syncedAt,
  };
}

function buildPayload(
  row: NormalizedUsageRow,
  metadata: {
    cliVersion: string;
    ccusageVersion: string;
    deviceId: string;
    deviceName: string;
    platform: SyncPlatform;
    syncedAt: string;
  },
): SyncPayload {
  return syncPayloadSchema.parse({
    provider: row.provider,
    date: row.date,
    tokenCategories: row.tokenCategories,
    ...(row.tokenDetails ? { tokenDetails: row.tokenDetails } : {}),
    totalTokens: row.totalTokens,
    ...(row.costUsd === undefined ? {} : { costUsd: row.costUsd }),
    ...(row.costSource ? { costSource: row.costSource } : {}),
    ...(row.costMetadata ? { costMetadata: row.costMetadata } : {}),
    ...(row.sourceSnapshot ? { sourceSnapshot: row.sourceSnapshot } : {}),
    ...(row.models ? { models: row.models } : {}),
    deviceId: metadata.deviceId,
    deviceName: metadata.deviceName,
    cliVersion: metadata.cliVersion,
    ccusageVersion: metadata.ccusageVersion,
    os: metadata.platform,
    syncedAt: metadata.syncedAt,
  });
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

function formatSyncMessage(
  submitted: number,
  failures: Array<{ provider: Provider; error: Error }>,
  skipped: Array<{ provider: Provider; error: Error }>,
): string {
  const parts = [`Submitted ${submitted} usage ${submitted === 1 ? "row" : "rows"}`];

  if (failures.length > 0) {
    parts.push(`Failed providers: ${formatFailures(failures)}`);
  }

  if (skipped.length > 0) {
    parts.push(`Skipped providers: ${formatFailures(skipped)}`);
  }

  return `${parts.join(". ")}.`;
}

function formatFailures(failures: Array<{ provider: Provider; error: Error }>): string {
  return failures.map(({ provider, error }) => `${provider}: ${trimTrailingPeriod(error.message)}`).join("; ");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function normalizeProviderError(error: unknown): Error {
  const normalizedError = toError(error);

  if (isMissingClaudeDataError(normalizedError)) {
    return new Error("No valid Claude data directories found");
  }

  if (isCcusageNativeBinaryPermissionError(normalizedError)) {
    return new Error(
      "ccusage native binary is not executable because the global npm install is not user-writable. Reinstall @blnayan/token-burn in a user-writable Node environment, or fix the binary execute bit once. Do not run token-burn sync with sudo.",
    );
  }

  return normalizedError;
}

function isSkippableProviderError(error: unknown): boolean {
  if (isUnsupportedCcusageProviderError(error)) return true;

  return isMissingClaudeDataError(toError(error));
}

function isMissingClaudeDataError(error: Error): boolean {
  return error.message.includes("No valid Claude data directories found");
}

function isCcusageNativeBinaryPermissionError(error: Error): boolean {
  return (
    error.message.includes("ccusage native binary is not executable") &&
    error.message.includes("EPERM") &&
    error.message.includes("chmod")
  );
}

function trimTrailingPeriod(message: string): string {
  return message.replace(/\.$/, "");
}
