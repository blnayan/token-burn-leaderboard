import {
  providers,
  syncPayloadSchema,
  type Provider,
  type SyncPayload,
  type SyncWindowsResponse,
} from "@token-burn/shared";

import type { NormalizedUsageRow, ProviderUsageWindow } from "./ccusage.js";
import {
  isUnsupportedCcusageProviderError,
  readCcusageVersion as readCcusageVersionFromPackage,
  readProviderUsage as readProviderUsageFromCcusage,
} from "./ccusage.js";
import type { TokenBurnServerClient } from "./server-client.js";

type SyncPlatform = Extract<NodeJS.Platform, "darwin" | "linux" | "win32">;

export type SyncCollectionIssue = {
  provider: Provider;
  message: string;
};

export type SyncCollectionResult = {
  failedProviders: SyncCollectionIssue[];
  skippedProviders: SyncCollectionIssue[];
  submitted: number;
};

export type SyncCollectionOptions = {
  token: string;
  deviceId: string;
  deviceName: string;
  cliVersion: string;
  platform: SyncPlatform;
  syncedAt: string;
  syncWindows: SyncWindowsResponse;
  serverClient: Pick<TokenBurnServerClient, "submitSyncPayload">;
  readProviderUsage?: (provider: Provider, options?: { window?: ProviderUsageWindow }) => Promise<NormalizedUsageRow[]>;
  readCcusageVersion?: () => Promise<string>;
};

export async function collectAndSubmitUsage({
  token,
  deviceId,
  deviceName,
  cliVersion,
  platform,
  syncedAt,
  syncWindows,
  serverClient,
  readProviderUsage = readProviderUsageFromCcusage,
  readCcusageVersion = readCcusageVersionFromPackage,
}: SyncCollectionOptions): Promise<SyncCollectionResult> {
  const ccusageVersion = await readCcusageVersion();
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
        const payload = buildPayload(row, { cliVersion, ccusageVersion, deviceId, deviceName, platform, syncedAt });
        await serverClient.submitSyncPayload({ token, payload });
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

  return {
    failedProviders: failures.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
    skippedProviders: skipped.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
    submitted,
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

function normalizeProviderError(error: unknown): Error {
  const normalizedError = toError(error);
  const missingProviderDataMessage = readMissingProviderDataMessage(normalizedError.message);

  if (missingProviderDataMessage) {
    return new Error(trimTrailingPeriod(missingProviderDataMessage));
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

  return isMissingProviderDataError(toError(error));
}

function isMissingProviderDataError(error: Error): boolean {
  return readMissingProviderDataMessage(error.message) !== null;
}

function readMissingProviderDataMessage(message: string): string | null {
  const dataDirectoryMatch = message.match(/\bNo valid [^.\n]* data directories found/i);

  if (dataDirectoryMatch) {
    return dataDirectoryMatch[0];
  }

  const usageDataMatch = message.match(/\bNo [^.\n]* usage data found/i);

  if (usageDataMatch) {
    return usageDataMatch[0];
  }

  return null;
}

function isCcusageNativeBinaryPermissionError(error: Error): boolean {
  return (
    error.message.includes("ccusage native binary is not executable") &&
    error.message.includes("EPERM") &&
    error.message.includes("chmod")
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function trimTrailingPeriod(message: string): string {
  return message.replace(/\.$/, "");
}
