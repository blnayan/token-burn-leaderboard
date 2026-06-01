import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

import type { Provider } from "@token-burn/shared";
import { sumTokenCategories } from "@token-burn/shared";

type NormalizedTokenCategories = {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
};

type NormalizedTokenDetails = {
  reasoningOutput?: number;
};

type CostMetadata = Record<string, unknown>;

type SourceSnapshot = Partial<
  Record<
    | "cachedInputTokens"
    | "cacheCreationTokens"
    | "cacheReadTokens"
    | "costUSD"
    | "inputTokens"
    | "outputTokens"
    | "reasoningOutputTokens"
    | "totalCost"
    | "totalTokens",
    number
  >
>;

export type NormalizedModelUsage = {
  modelName: string;
  tokenCategories: NormalizedTokenCategories;
  tokenDetails?: NormalizedTokenDetails;
  totalTokens: number;
  costUsd?: number;
  metadata?: {
    isFallback?: boolean;
  };
};

export type NormalizedUsageRow = {
  provider: Provider;
  date: string;
  tokenCategories: NormalizedTokenCategories;
  tokenDetails?: NormalizedTokenDetails;
  totalTokens: number;
  costUsd?: number;
  costSource?: "ccusage";
  costMetadata?: CostMetadata;
  sourceSnapshot?: SourceSnapshot;
  models?: NormalizedModelUsage[];
};

type CcusageProvider = Extract<Provider, "claude_code" | "codex">;

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export class UnsupportedCcusageProviderError extends Error {
  readonly provider: CcusageProvider;

  constructor(provider: CcusageProvider) {
    super("ccusage does not support Codex usage in the installed version.");
    this.name = "UnsupportedCcusageProviderError";
    this.provider = provider;
  }
}

export function isUnsupportedCcusageProviderError(error: unknown): error is UnsupportedCcusageProviderError {
  return error instanceof UnsupportedCcusageProviderError;
}

const tokenFieldAliases = {
  input: ["inputTokens", "input_tokens", "input"],
  output: ["outputTokens", "output_tokens", "output"],
  cacheCreate: ["cacheCreationTokens", "cacheCreateTokens", "cache_creation_tokens"],
  cacheRead: ["cacheReadTokens", "cachedInputTokens", "cache_read_tokens"],
} as const;

const tokenDetailAliases = {
  reasoningOutput: ["reasoningOutputTokens", "reasoning_output_tokens"],
} as const;

export function normalizeCcusageDailyRows(provider: Provider, rows: unknown[]): NormalizedUsageRow[] {
  return rows.map((row) => {
    const record = toRecord(row);
    const tokenCategories = {
      input: readTokenField(record, tokenFieldAliases.input),
      output: readTokenField(record, tokenFieldAliases.output),
      cacheCreate: readTokenField(record, tokenFieldAliases.cacheCreate),
      cacheRead: readTokenField(record, tokenFieldAliases.cacheRead),
    };
    const tokenDetails = readOptionalTokenDetails(record);
    const costUsd = readOptionalCostUsd(record);
    const sourceSnapshot = sanitizeSourceSnapshot(record);
    const models = normalizeModelUsage(record.models);

    const normalized: NormalizedUsageRow = {
      provider,
      date: readDate(record),
      tokenCategories,
      totalTokens: readTotalTokens(record, tokenCategories),
    };

    if (tokenDetails) {
      normalized.tokenDetails = tokenDetails;
    }

    if (costUsd !== undefined) {
      normalized.costUsd = costUsd;
      normalized.costSource = "ccusage";
    }

    if ((costUsd !== undefined || tokenDetails || models.length > 0) && Object.keys(sourceSnapshot).length > 0) {
      normalized.sourceSnapshot = sourceSnapshot;
    }

    if (models.length > 0) {
      normalized.models = models;
    }

    return normalized;
  });
}

export async function readProviderUsage(
  provider: CcusageProvider,
  { runCommand = spawnCommand }: { runCommand?: CommandRunner } = {},
): Promise<NormalizedUsageRow[]> {
  const command = resolveCcusageCommand();
  let result: CommandResult;

  try {
    result = await runCommand(command, buildCcusageArgs(provider));
  } catch (error) {
    if (provider !== "claude_code" || !isUnsupportedBreakdownError(error)) {
      throw error;
    }

    result = await runCommand(command, buildCcusageArgs(provider, true));
  }

  const parsed = JSON.parse(result.stdout) as unknown;
  const rows = Array.isArray(parsed) ? parsed : readDailyArray(parsed);

  return normalizeCcusageDailyRows(provider, rows);
}

export function buildCcusageArgs(provider: CcusageProvider, fallback = false): string[] {
  if (provider === "claude_code") {
    const args = ["claude", "daily", "--json", "--timezone", "UTC"];
    return fallback ? args : [...args, "--breakdown"];
  }

  return ["codex", "daily", "--json", "--timezone", "UTC"];
}

function isUnsupportedBreakdownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return (
    normalized.includes("breakdown unavailable") ||
    (normalized.includes("--breakdown") &&
      (normalized.includes("unknown option") || normalized.includes("not supported"))) ||
    (normalized.includes("breakdown") && normalized.includes("not supported"))
  );
}

export async function readCcusageVersion(): Promise<string> {
  const packageJsonPath = fileURLToPath(new URL("../node_modules/ccusage/package.json", import.meta.url));
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const record = toRecord(parsed);
  const version = record.version;

  if (typeof version !== "string" || !version) {
    throw new Error("Unable to determine ccusage version.");
  }

  return version;
}

function resolveCcusageCommand(): string {
  const binName = platform() === "win32" ? "ccusage.cmd" : "ccusage";
  const bundledBin = fileURLToPath(new URL(`../node_modules/.bin/${binName}`, import.meta.url));

  return existsSync(bundledBin) ? bundledBin : "ccusage";
}

function spawnCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr.trim() || `ccusage exited with status ${code ?? "unknown"}.`;
      reject(new Error(message));
    });
  });
}

function readDailyArray(value: unknown): unknown[] {
  const record = toRecord(value);
  const daily = record.daily;

  if (!Array.isArray(daily)) {
    throw new Error("Expected ccusage JSON output to be an array or an object with a daily array.");
  }

  return daily;
}

function readDate(record: Record<string, unknown>): string {
  const date = record.date;

  if (typeof date !== "string") {
    throw new Error("ccusage daily row is missing a date.");
  }

  return date;
}

function readTokenField(record: Record<string, unknown>, fields: readonly string[]): number {
  const field = fields.find((candidate) => record[candidate] !== undefined);
  const value = field ? record[field] : 0;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`ccusage daily row has an invalid ${field ?? fields[0]} value.`);
  }

  return Math.trunc(value);
}

function readOptionalTokenDetails(record: Record<string, unknown>): NormalizedTokenDetails | undefined {
  const reasoningOutput = readOptionalTokenDetail(record, tokenDetailAliases.reasoningOutput);

  return reasoningOutput > 0 ? { reasoningOutput } : undefined;
}

function readOptionalTokenDetail(record: Record<string, unknown>, fields: readonly string[]): number {
  const field = fields.find((candidate) => record[candidate] !== undefined);

  if (!field) {
    return 0;
  }

  const value = record[field];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`ccusage daily row has an invalid ${field} value.`);
  }

  return Math.trunc(value);
}

function readOptionalCostUsd(record: Record<string, unknown>): number | undefined {
  const field = ["costUSD", "costUsd", "totalCost"].find((candidate) => record[candidate] !== undefined);

  if (!field) {
    return undefined;
  }

  const value = record[field];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
    throw new Error(`ccusage daily row has an invalid ${field} value.`);
  }

  return value;
}

function readTotalTokens(record: Record<string, unknown>, tokenCategories: NormalizedTokenCategories): number {
  const field = ["totalTokens", "total_tokens"].find((candidate) => record[candidate] !== undefined);

  if (!field) {
    return sumTokenCategories(tokenCategories);
  }

  const value = record[field];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`ccusage daily row has an invalid ${field} value.`);
  }

  return Math.trunc(value);
}

function sanitizeSourceSnapshot(record: Record<string, unknown>): SourceSnapshot {
  const snapshot: SourceSnapshot = {};
  const fields = [
    "cachedInputTokens",
    "cacheCreationTokens",
    "cacheReadTokens",
    "costUSD",
    "inputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalCost",
    "totalTokens",
  ] as const;

  for (const field of fields) {
    const value = record[field];

    if (typeof value === "number" && Number.isFinite(value)) {
      snapshot[field] = value;
    }
  }

  return snapshot;
}

function normalizeModelUsage(models: unknown): NormalizedModelUsage[] {
  if (models === undefined) {
    return [];
  }

  const record = toRecord(models);

  return Object.entries(record)
    .map(([modelName, value]) => {
      const modelRecord = toRecord(value);
      const tokenCategories = {
        input: readTokenField(modelRecord, tokenFieldAliases.input),
        output: readTokenField(modelRecord, tokenFieldAliases.output),
        cacheCreate: readTokenField(modelRecord, tokenFieldAliases.cacheCreate),
        cacheRead: readTokenField(modelRecord, tokenFieldAliases.cacheRead),
      };
      const normalized: NormalizedModelUsage = {
        modelName,
        tokenCategories,
        totalTokens: readTotalTokens(modelRecord, tokenCategories),
      };
      const tokenDetails = readOptionalTokenDetails(modelRecord);
      const costUsd = readOptionalCostUsd(modelRecord);

      if (tokenDetails) {
        normalized.tokenDetails = tokenDetails;
      }

      if (costUsd !== undefined) {
        normalized.costUsd = costUsd;
      }

      if (typeof modelRecord.isFallback === "boolean") {
        normalized.metadata = {
          isFallback: modelRecord.isFallback,
        };
      }

      return normalized;
    })
    .sort((left, right) => left.modelName.localeCompare(right.modelName));
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }

  return value as Record<string, unknown>;
}
