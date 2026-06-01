import { readFile } from "node:fs/promises";
import { platform as readPlatform } from "node:os";

import type { Provider, SyncPayload } from "@token-burn/shared";
import { syncPayloadSchema } from "@token-burn/shared";

import type { NormalizedUsageRow } from "./ccusage.js";
import { readCcusageVersion as readCcusageVersionFromPackage, readProviderUsage as readProviderUsageFromCcusage } from "./ccusage.js";
import type { CliConfig } from "./config.js";
import { readConfig as readConfigFile, writeConfig as writeConfigFile } from "./config.js";
import { postJson as postJsonRequest } from "./http.js";

type SyncPlatform = Extract<NodeJS.Platform, "darwin" | "linux" | "win32">;

export type SyncDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  postJson?: <T>(url: string, body: unknown, token?: string) => Promise<T>;
  readProviderUsage?: (provider: Provider) => Promise<NormalizedUsageRow[]>;
  readCcusageVersion?: () => Promise<string>;
  now?: () => Date;
  platform?: SyncPlatform;
  cliVersion?: string;
  log?: (message: string) => void;
};

const providers: Provider[] = ["claude_code", "codex"];

export async function syncUsage({
  readConfig = readConfigFile,
  writeConfig = writeConfigFile,
  postJson = postJsonRequest,
  readProviderUsage = readProviderUsageFromCcusage,
  readCcusageVersion = readCcusageVersionFromPackage,
  now = () => new Date(),
  platform = normalizePlatform(readPlatform()),
  cliVersion,
  log = console.log,
}: SyncDependencies = {}): Promise<void> {
  const config = await readConfig();

  if (!config?.token) {
    const serverUrl = config?.serverUrl ?? process.env.TOKEN_BURN_SERVER_URL ?? "http://localhost:3000";
    throw new Error(`Run token-burn login --server ${serverUrl} to authenticate.`);
  }

  const syncedAt = now().toISOString();
  const version = cliVersion ?? (await readCliVersion());
  const ccusageVersion = await readCcusageVersion();
  const syncUrl = `${config.serverUrl.replace(/\/+$/, "")}/api/sync`;
  const failures: Array<{ provider: Provider; error: Error }> = [];
  let submitted = 0;

  for (const provider of providers) {
    try {
      const rows = await readProviderUsage(provider);

      for (const row of rows) {
        const payload = buildPayload(row, { cliVersion: version, ccusageVersion, platform, syncedAt });
        await postJson(syncUrl, payload, config.token);
        submitted += 1;
      }
    } catch (error) {
      failures.push({ provider, error: toError(error) });
    }
  }

  const message = formatSyncMessage(submitted, failures);
  const lastSync = {
    ok: failures.length === 0,
    message,
    at: syncedAt,
  };

  await writeConfig({ ...config, lastSync });

  if (submitted === 0 && failures.length === providers.length) {
    throw new Error(`All providers failed: ${formatFailures(failures)}.`);
  }

  log(message);
}

function buildPayload(
  row: NormalizedUsageRow,
  metadata: {
    cliVersion: string;
    ccusageVersion: string;
    platform: SyncPlatform;
    syncedAt: string;
  },
): SyncPayload {
  return syncPayloadSchema.parse({
    provider: row.provider,
    date: row.date,
    tokenCategories: row.tokenCategories,
    totalTokens: row.totalTokens,
    cliVersion: metadata.cliVersion,
    ccusageVersion: metadata.ccusageVersion,
    os: metadata.platform,
    syncedAt: metadata.syncedAt,
  });
}

async function readCliVersion(): Promise<string> {
  const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Unable to determine CLI version.");
  }

  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || !version) {
    throw new Error("Unable to determine CLI version.");
  }

  return version;
}

function normalizePlatform(value: NodeJS.Platform): SyncPlatform {
  if (value === "darwin" || value === "linux" || value === "win32") {
    return value;
  }

  throw new Error(`Unsupported platform for sync: ${value}.`);
}

function formatSyncMessage(submitted: number, failures: Array<{ provider: Provider; error: Error }>): string {
  const submittedText = `Submitted ${submitted} usage ${submitted === 1 ? "row" : "rows"}.`;

  if (failures.length === 0) {
    return submittedText;
  }

  return `${submittedText} Failed providers: ${formatFailures(failures)}.`;
}

function formatFailures(failures: Array<{ provider: Provider; error: Error }>): string {
  return failures.map(({ provider, error }) => `${provider}: ${error.message}`).join("; ");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
