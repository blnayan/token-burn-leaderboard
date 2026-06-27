import {
  providers,
  syncPayloadSchema,
  type Provider,
  type SyncPayload,
  type SyncWindowsResponse,
} from "@token-burn/shared";

import type { NormalizedUsageRow, ProviderUsageWindow } from "./tokscale.js";
import {
  isUnsupportedTokscaleProviderError,
  readProviderUsage as readProviderUsageFromTokscale,
  readTokscaleVersion,
} from "./tokscale.js";
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
  readSourceVersion?: () => Promise<string>;
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
  readProviderUsage = readProviderUsageFromTokscale,
  readSourceVersion = readTokscaleVersion,
}: SyncCollectionOptions): Promise<SyncCollectionResult> {
  const sourceVersion = await readSourceVersion();
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
        const payload = buildPayload(row, { cliVersion, sourceVersion, deviceId, deviceName, platform, syncedAt });
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
    deviceId: string;
    deviceName: string;
    platform: SyncPlatform;
    sourceVersion: string;
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
    ccusageVersion: metadata.sourceVersion,
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

  return normalizedError;
}

function isSkippableProviderError(error: unknown): boolean {
  if (isUnsupportedTokscaleProviderError(error)) return true;

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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function trimTrailingPeriod(message: string): string {
  return message.replace(/\.$/, "");
}
