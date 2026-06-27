import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { formatProvider, providerMetadata, sumTokenCategories, type Provider } from "@token-burn/shared";

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
type SourceSnapshot = Record<string, number>;

export type NormalizedModelUsage = {
  modelName: string;
  tokenCategories: NormalizedTokenCategories;
  tokenDetails?: NormalizedTokenDetails;
  totalTokens: number;
  costUsd?: number;
  metadata?: CostMetadata;
};

export type NormalizedUsageRow = {
  provider: Provider;
  date: string;
  tokenCategories: NormalizedTokenCategories;
  tokenDetails?: NormalizedTokenDetails;
  totalTokens: number;
  costUsd?: number;
  costSource?: "tokscale";
  costMetadata?: CostMetadata;
  sourceSnapshot?: SourceSnapshot;
  models?: NormalizedModelUsage[];
};

export type ProviderUsageWindow = {
  since?: string;
  until: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type CommandInvocation = {
  command: string;
  args: string[];
};

type TokscaleProvider = Provider;

type TokscaleTokens = {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  reasoningOutput: number;
};

type ModelAccumulator = {
  modelName: string;
  tokenCategories: NormalizedTokenCategories;
  reasoningOutput: number;
  totalTokens: number;
  costUsd?: number;
  metadata: CostMetadata;
};

type TokscaleProviderMetadata = {
  label: string;
  tokscaleClient?: string;
};

const requireFromCli = createRequire(import.meta.url);
const tokscaleProviderMetadata = providerMetadata as Record<string, TokscaleProviderMetadata | undefined>;

export class UnsupportedTokscaleProviderError extends Error {
  readonly provider: TokscaleProvider;

  constructor(provider: TokscaleProvider) {
    super(`tokscale does not support ${formatProviderName(provider)} usage in the installed version.`);
    this.name = "UnsupportedTokscaleProviderError";
    this.provider = provider;
  }
}

export function isUnsupportedTokscaleProviderError(error: unknown): error is UnsupportedTokscaleProviderError {
  return error instanceof UnsupportedTokscaleProviderError;
}

export function buildTokscaleGraphArgs(provider: TokscaleProvider, window?: ProviderUsageWindow): string[] {
  const client = readTokscaleClient(provider);
  const args = ["graph", "--client", client];

  if (window?.since) {
    args.push("--since", window.since, "--until", window.until);
  }

  args.push("--no-spinner");
  return args;
}

export function normalizeTokscaleGraph(provider: TokscaleProvider, graph: unknown): NormalizedUsageRow[] {
  assertSupportedProvider(provider);

  const contributions = readContributions(graph);

  return contributions.map((contribution) => normalizeContribution(provider, contribution));
}

export async function readProviderUsage(
  provider: TokscaleProvider,
  { runCommand = spawnCommand, window }: { runCommand?: CommandRunner; window?: ProviderUsageWindow } = {},
): Promise<NormalizedUsageRow[]> {
  assertSupportedProvider(provider);

  const fixtureDir = process.env.TOKEN_BURN_E2E_FIXTURE_DIR;

  if (fixtureDir) {
    return readProviderUsageFixture(provider, fixtureDir);
  }

  let result: CommandResult;

  try {
    result = await runCommand("tokscale", buildTokscaleGraphArgs(provider, window));
  } catch (error) {
    if (isUnsupportedClientCommandError(error)) {
      throw new UnsupportedTokscaleProviderError(provider);
    }

    if (isNoDataFoundOutput(errorMessage(error))) {
      throw new Error(`No ${formatProviderName(provider)} usage data found`);
    }

    throw error;
  }

  const output = `${result.stdout}\n${result.stderr}`;

  if (isNoDataFoundOutput(output)) {
    throw new Error(`No ${formatProviderName(provider)} usage data found`);
  }

  const rows = normalizeTokscaleGraph(provider, JSON.parse(result.stdout) as unknown);

  if (rows.length === 0 && !window?.since) {
    throw new Error(`No ${formatProviderName(provider)} usage data found`);
  }

  return rows;
}

export async function readTokscaleVersion(): Promise<string> {
  try {
    const packageJsonPath = requireFromCli.resolve("tokscale/package.json");
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const version = toRecord(parsed).version;

    if (typeof version !== "string" || !version) {
      throw new Error("tokscale package.json does not include a version.");
    }

    return version;
  } catch (error) {
    throw new Error("Unable to determine tokscale version.", { cause: error });
  }
}

async function readProviderUsageFixture(provider: TokscaleProvider, fixtureDir: string): Promise<NormalizedUsageRow[]> {
  const fixturePath = join(fixtureDir, `${provider}.json`);
  let raw: string;

  try {
    raw = await readFile(fixturePath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }

    throw error;
  }

  return normalizeTokscaleGraph(provider, JSON.parse(raw) as unknown);
}

function normalizeContribution(provider: TokscaleProvider, contribution: unknown): NormalizedUsageRow {
  const record = toRecord(contribution);
  const date = readString(record, "date", "tokscale daily contribution is missing a date.");
  const totals = toRecord(record.totals);
  const tokens = readTokscaleTokens(record.tokenBreakdown);
  const tokenCategories = toTokenCategories(tokens);
  const totalTokens = readNumber(totals, "tokens", "tokscale daily contribution has an invalid total token value.");
  const expectedTotalTokens = sumTokenCategories(tokenCategories);

  if (totalTokens !== expectedTotalTokens) {
    throw new Error("tokscale daily contribution total does not match token breakdown");
  }

  const client = readTokscaleClient(provider);
  const costUsd = readOptionalNumber(totals, "cost", "tokscale daily contribution has an invalid cost value.");
  const messages = readOptionalNumber(totals, "messages", "tokscale daily contribution has an invalid messages value.");
  const clients = readClients(record.clients);
  const models = normalizeModels(clients);
  const normalized: NormalizedUsageRow = {
    provider,
    date,
    tokenCategories,
    totalTokens,
    costSource: "tokscale",
    sourceSnapshot: {
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheCreationTokens: tokens.cacheCreate,
      cacheReadTokens: tokens.cacheRead,
      reasoningOutputTokens: tokens.reasoningOutput,
      totalTokens,
      ...(costUsd === undefined ? {} : { totalCost: costUsd }),
    },
  };
  const tokenDetails = toTokenDetails(tokens.reasoningOutput);
  const costMetadata = buildDailyCostMetadata(client, messages, clients);

  if (tokenDetails) {
    normalized.tokenDetails = tokenDetails;
  }

  if (costUsd !== undefined) {
    normalized.costUsd = costUsd;
  }

  if (Object.keys(costMetadata).length > 0) {
    normalized.costMetadata = costMetadata;
  }

  if (models.length > 0) {
    normalized.models = models;
  }

  return normalized;
}

function normalizeModels(clients: Array<Record<string, unknown>>): NormalizedModelUsage[] {
  const byName = new Map<string, ModelAccumulator>();

  for (const clientRecord of clients) {
    const modelName = readModelName(clientRecord);
    const tokens = readTokscaleTokens(clientRecord.tokens);
    const tokenCategories = toTokenCategories(tokens);
    const totalTokens = sumTokenCategories(tokenCategories);
    const costUsd = readOptionalNumber(clientRecord, "cost", "tokscale client row has an invalid cost value.");
    const messages = readOptionalNumber(clientRecord, "messages", "tokscale client row has an invalid messages value.");
    const client = readOptionalString(clientRecord.client);
    const providerId = readOptionalString(clientRecord.providerId ?? clientRecord.provider_id);
    let accumulator = byName.get(modelName);

    if (!accumulator) {
      accumulator = {
        modelName,
        tokenCategories: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
        reasoningOutput: 0,
        totalTokens: 0,
        metadata: {},
      };
      byName.set(modelName, accumulator);
    }

    accumulator.tokenCategories.input += tokenCategories.input;
    accumulator.tokenCategories.output += tokenCategories.output;
    accumulator.tokenCategories.cacheCreate += tokenCategories.cacheCreate;
    accumulator.tokenCategories.cacheRead += tokenCategories.cacheRead;
    accumulator.reasoningOutput += tokens.reasoningOutput;
    accumulator.totalTokens += totalTokens;

    if (costUsd !== undefined) {
      accumulator.costUsd = (accumulator.costUsd ?? 0) + costUsd;
    }

    mergeMetadata(accumulator.metadata, { client, providerId, messages });
  }

  return [...byName.values()].map(toNormalizedModelUsage);
}

function toNormalizedModelUsage(accumulator: ModelAccumulator): NormalizedModelUsage {
  const normalized: NormalizedModelUsage = {
    modelName: accumulator.modelName,
    tokenCategories: accumulator.tokenCategories,
    totalTokens: accumulator.totalTokens,
  };
  const tokenDetails = toTokenDetails(accumulator.reasoningOutput);

  if (tokenDetails) {
    normalized.tokenDetails = tokenDetails;
  }

  if (accumulator.costUsd !== undefined) {
    normalized.costUsd = accumulator.costUsd;
  }

  if (Object.keys(accumulator.metadata).length > 0) {
    normalized.metadata = accumulator.metadata;
  }

  return normalized;
}

function buildDailyCostMetadata(
  client: string,
  messages: number | undefined,
  clients: Array<Record<string, unknown>>,
): CostMetadata {
  const metadata: CostMetadata = { client };
  const providerIds = new Set<string>();

  if (messages !== undefined) {
    metadata.messages = messages;
  }

  for (const clientRecord of clients) {
    const providerId = readOptionalString(clientRecord.providerId ?? clientRecord.provider_id);

    if (providerId) {
      providerIds.add(providerId);
    }
  }

  if (providerIds.size === 1) {
    metadata.providerId = [...providerIds][0];
  } else if (providerIds.size > 1) {
    metadata.providerIds = [...providerIds];
  }

  return metadata;
}

function mergeMetadata(
  metadata: CostMetadata,
  values: { client?: string; providerId?: string; messages?: number },
): void {
  if (values.client) {
    mergeStableValue(metadata, "client", "clients", values.client);
  }

  if (values.providerId) {
    mergeStableValue(metadata, "providerId", "providerIds", values.providerId);
  }

  if (values.messages !== undefined) {
    metadata.messages = typeof metadata.messages === "number" ? metadata.messages + values.messages : values.messages;
  }
}

function mergeStableValue(metadata: CostMetadata, singularKey: string, pluralKey: string, value: string): void {
  const existing = metadata[singularKey];

  if (existing === undefined) {
    metadata[singularKey] = value;
    return;
  }

  if (existing === value) {
    return;
  }

  delete metadata[singularKey];

  const values = Array.isArray(metadata[pluralKey]) ? (metadata[pluralKey] as string[]) : [String(existing)];

  if (!values.includes(value)) {
    values.push(value);
  }

  metadata[pluralKey] = values;
}

function toTokenCategories(tokens: TokscaleTokens): NormalizedTokenCategories {
  return {
    input: tokens.input,
    output: tokens.output,
    cacheCreate: tokens.cacheCreate,
    cacheRead: tokens.cacheRead,
  };
}

function toTokenDetails(reasoningOutput: number): NormalizedTokenDetails | undefined {
  return reasoningOutput > 0 ? { reasoningOutput } : undefined;
}

function readTokscaleTokens(value: unknown): TokscaleTokens {
  const record = toRecord(value);

  return {
    input: readToken(record, "input"),
    output: readToken(record, "output"),
    cacheCreate: readToken(record, "cacheWrite"),
    cacheRead: readToken(record, "cacheRead"),
    reasoningOutput: readToken(record, "reasoning"),
  };
}

function readToken(record: Record<string, unknown>, field: string): number {
  const value = record[field] ?? 0;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`tokscale token breakdown has an invalid ${field} value.`);
  }

  return Math.trunc(value);
}

function readContributions(graph: unknown): unknown[] {
  const record = toRecord(graph);

  if (!Array.isArray(record.contributions)) {
    throw new Error("Expected tokscale graph JSON output to include a contributions array.");
  }

  return record.contributions;
}

function readClients(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("tokscale daily contribution has an invalid clients value.");
  }

  return value.map(toRecord);
}

function readModelName(record: Record<string, unknown>): string {
  const value = readOptionalString(record.modelId ?? record.model_id);

  if (!value) {
    throw new Error("tokscale client row is missing a model name.");
  }

  return value;
}

function readString(record: Record<string, unknown>, field: string, message: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }

  return value.trim();
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown>, field: string, message: string): number {
  const value = record[field];

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(message);
  }

  return Math.trunc(value);
}

function readOptionalNumber(record: Record<string, unknown>, field: string, message: string): number | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(message);
  }

  return field === "messages" ? Math.trunc(value) : value;
}

function readTokscaleClient(provider: TokscaleProvider): string {
  assertSupportedProvider(provider);
  return tokscaleProviderMetadata[provider]?.tokscaleClient ?? "";
}

function assertSupportedProvider(provider: TokscaleProvider): asserts provider is Provider {
  if (
    typeof provider !== "string" ||
    !(provider in tokscaleProviderMetadata) ||
    typeof tokscaleProviderMetadata[provider]?.tokscaleClient !== "string"
  ) {
    throw new UnsupportedTokscaleProviderError(provider);
  }
}

function isUnsupportedClientCommandError(error: unknown): boolean {
  const message = errorMessage(error);

  return /invalid value ['"][^'"]+['"] for ['"]--client <CLIENTS?>['"]/i.test(message);
}

function isNoDataFoundOutput(message: string): boolean {
  return /\bNo data found for client\b/i.test(message) || /\bNo local data found\b/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function spawnCommand(command: string, args: string[]): Promise<CommandResult> {
  const invocation = command === "tokscale" ? resolveTokscaleInvocation(args) : { command, args };

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { stdio: ["ignore", "pipe", "pipe"] });
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

      const message = stderr.trim() || stdout.trim() || `tokscale exited with status ${code ?? "unknown"}.`;
      reject(new Error(message));
    });
  });
}

function resolveTokscaleInvocation(args: string[]): CommandInvocation {
  const binPath = resolveTokscaleBinPath();
  return { command: process.execPath, args: [binPath, ...args] };
}

function resolveTokscaleBinPath(): string {
  const packageJsonPath = requireFromCli.resolve("tokscale/package.json");
  const packageRoot = dirname(packageJsonPath);
  const parsed = requireFromCli(packageJsonPath) as { bin?: string | Record<string, string> };
  const bin = typeof parsed.bin === "string" ? parsed.bin : parsed.bin?.tokscale;

  if (!bin) {
    throw new Error("Unable to determine tokscale executable path.");
  }

  return resolve(packageRoot, bin);
}

function formatProviderName(provider: TokscaleProvider): string {
  return typeof provider === "string" && provider in providerMetadata
    ? formatProvider(provider as Provider)
    : String(provider);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }

  return value as Record<string, unknown>;
}
