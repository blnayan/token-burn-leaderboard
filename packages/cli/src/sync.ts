import { randomUUID } from "node:crypto";
import { hostname, platform as readPlatform } from "node:os";

import { syncPayloadSchema, syncWindowsResponseSchema, type Provider, type SyncPayload } from "@token-burn/shared";

import type { NormalizedUsageRow, ProviderUsageWindow } from "./ccusage.js";
import {
  isUnsupportedCcusageProviderError,
  readCcusageVersion as readCcusageVersionFromPackage,
  readProviderUsage as readProviderUsageFromCcusage,
} from "./ccusage.js";
import type { CliConfig } from "./config.js";
import { readConfig as readConfigFile, writeConfig as writeConfigFile } from "./config.js";
import { defaultServerUrl } from "./defaults.js";
import { getJson as getJsonRequest, postJson as postJsonRequest } from "./http.js";
import { cliVersion as packageCliVersion } from "./version.js";

type SyncPlatform = Extract<NodeJS.Platform, "darwin" | "linux" | "win32">;

type CliHealth = {
  requiredCliVersion: string;
  serverTime: string;
};

export type SyncDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  getJson?: <T>(url: string, token?: string) => Promise<T>;
  postJson?: <T>(url: string, body: unknown, token?: string) => Promise<T>;
  readHealth?: (serverUrl: string) => Promise<CliHealth>;
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

export function syncUsage(dependencies?: SyncDependencies): Promise<SyncResult>;
export async function syncUsage({
  readConfig = readConfigFile,
  writeConfig = writeConfigFile,
  getJson = getJsonRequest,
  postJson = postJsonRequest,
  readHealth = readHealthFromServer,
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

  const syncedAt = now().toISOString();
  const version = cliVersion ?? packageCliVersion;
  const health = await readHealth(config.serverUrl);
  ensureRequiredCliVersion(version, health.requiredCliVersion);

  const deviceId = config.deviceId ?? createDeviceId();
  const deviceName = normalizeDeviceName(readDeviceName());
  const configWithDevice = { ...config, deviceId, deviceName };
  await writeConfig(configWithDevice);

  const ccusageVersion = await readCcusageVersion();
  const syncWindows = await readSyncWindows({ getJson, serverUrl: config.serverUrl, token: config.token, deviceId });
  const providerWindows = new Map(syncWindows.providers.map((window) => [window.provider, window]));
  const syncUrl = `${config.serverUrl.replace(/\/+$/, "")}/api/sync`;
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
        await postJson(syncUrl, payload, config.token);
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

async function readSyncWindows({
  getJson,
  serverUrl,
  token,
  deviceId,
}: {
  getJson: <T>(url: string, token?: string) => Promise<T>;
  serverUrl: string;
  token: string;
  deviceId: string;
}) {
  const url = `${serverUrl.replace(/\/+$/, "")}/api/cli/sync-windows?deviceId=${encodeURIComponent(deviceId)}`;
  const response = await getJson<unknown>(url, token);
  return syncWindowsResponseSchema.parse(response);
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

async function readHealthFromServer(serverUrl: string): Promise<CliHealth> {
  const normalizedServerUrl = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${normalizedServerUrl}/api/cli/health`);
  const text = await response.text();
  const data = parseJsonOrNull(text);

  if (!response.ok) {
    throw new Error(formatHttpError(response, text));
  }

  if (!isRecord(data)) {
    throw new Error("Invalid health response");
  }

  const { requiredCliVersion, serverTime } = data;

  if (
    typeof requiredCliVersion !== "string" ||
    typeof serverTime !== "string"
  ) {
    throw new Error("Invalid health response");
  }

  return { requiredCliVersion, serverTime };
}

function ensureRequiredCliVersion(actualVersion: string, requiredVersion: string): void {
  if (actualVersion === requiredVersion) return;

  throw new Error(
    `Token Burn requires token-burn ${requiredVersion}. You have ${actualVersion}. Run npm install -g @blnayan/token-burn@latest.`,
  );
}

function parseJsonOrNull(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function formatHttpError(response: Response, text: string): string {
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const body = text.trim();

  return body ? `${status}: ${body}` : status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
