import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

import type { Provider } from "@token-burn/shared";
import { sumTokenCategories } from "@token-burn/shared";

export type NormalizedUsageRow = {
  provider: Provider;
  date: string;
  tokenCategories: {
    input: number;
    output: number;
    cacheCreate: number;
    cacheRead: number;
  };
  totalTokens: number;
};

type CcusageProvider = Extract<Provider, "claude_code" | "codex">;

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

const providerCommands: Record<CcusageProvider, string[]> = {
  claude_code: ["claude", "daily", "--json"],
  codex: ["codex", "daily", "--json"],
};

const tokenFieldAliases = {
  input: ["inputTokens", "input_tokens", "input"],
  output: ["outputTokens", "output_tokens", "output"],
  cacheCreate: ["cacheCreationTokens", "cacheCreateTokens", "cache_creation_tokens"],
  cacheRead: ["cacheReadTokens", "cache_read_tokens"],
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

    return {
      provider,
      date: readDate(record),
      tokenCategories,
      totalTokens: sumTokenCategories(tokenCategories),
    };
  });
}

export async function readProviderUsage(
  provider: CcusageProvider,
  { runCommand = spawnCommand }: { runCommand?: CommandRunner } = {},
): Promise<NormalizedUsageRow[]> {
  const args = providerCommands[provider];
  const result = await runCommand(resolveCcusageCommand(), args);
  const parsed = JSON.parse(result.stdout) as unknown;
  const rows = Array.isArray(parsed) ? parsed : readDailyArray(parsed);

  return normalizeCcusageDailyRows(provider, rows);
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

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }

  return value as Record<string, unknown>;
}
