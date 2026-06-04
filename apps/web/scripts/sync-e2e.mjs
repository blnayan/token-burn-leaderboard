import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = requiredEnv("DATABASE_URL");
const serverUrl = process.env.TOKEN_BURN_E2E_SERVER_URL ?? "http://127.0.0.1:3100";
const cliBin = process.env.TOKEN_BURN_CLI_BIN ?? "token-burn";

assertLocalE2eTargets({ databaseUrl, serverUrl });

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const expectedDeviceName = hostname();
const expectedDate = "2026-06-03";
const expectedOs = process.platform;
const syncTimeoutMs = 60_000;
const setupTimeoutMs = 90_000;

const expectedProviders = {
  claude_code: {
    totalTokens: 1000,
    tokenCategories: { input: 100, output: 200, cacheCreate: 300, cacheRead: 400 },
    tokenDetails: null,
    costUsd: "1.234567",
    costMetadata: { currency: "USD", pricingVersion: "e2e-claude" },
    sourceSnapshot: {
      cacheCreationTokens: 300,
      cacheReadTokens: 400,
      costUSD: 1.234567,
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 1000,
    },
    models: [
      { modelName: "claude-haiku-3.5", totalTokens: 400, costUsd: "0.345678" },
      { modelName: "claude-sonnet-4", totalTokens: 600, costUsd: "0.888889" },
    ],
  },
  codex: {
    totalTokens: 600,
    tokenCategories: { input: 100, output: 200, cacheCreate: 0, cacheRead: 300 },
    tokenDetails: { reasoningOutput: 50 },
    costUsd: "0.654321",
    costMetadata: { currency: "USD", pricingVersion: "e2e-codex" },
    sourceSnapshot: {
      cachedInputTokens: 300,
      costUSD: 0.654321,
      inputTokens: 100,
      outputTokens: 200,
      reasoningOutputTokens: 50,
      totalTokens: 600,
    },
    models: [
      { modelName: "gpt-5.5", totalTokens: 450, costUsd: "0.444444" },
      { modelName: "gpt-5.5-mini", totalTokens: 150, costUsd: "0.111111" },
    ],
  },
};

const tempDirs = [];

try {
  console.log(`Sync E2E server: ${serverUrl}`);
  await waitForHealth();

  const member = await seedMember();
  const fixtureDir = await writeFixtures();
  const setup = await runSetupFlow({ memberId: member.id, fixtureDir });
  const { configDir, config } = setup;
  const expectedDeviceId = config.deviceId;

  await assertDatabaseState({ memberId: member.id, expectedDeviceId, expectedLastSyncCount: 1 });
  const countsAfterFirstSync = await readCounts(member.id);

  await runSync({ configDir, fixtureDir, expectSuccess: true });
  await assertDatabaseState({ memberId: member.id, expectedDeviceId, expectedLastSyncCount: 2 });
  const countsAfterSecondSync = await readCounts(member.id);
  assertJsonEqual(countsAfterSecondSync, countsAfterFirstSync, "second sync row counts");

  const countsBeforeBadToken = await readCounts(member.id);
  const globalCountsBeforeBadToken = await readGlobalCounts();
  const badConfigDir = await writeAuthenticatedConfig("tb_bad_token_for_e2e", { deviceId: expectedDeviceId });
  await runSync({ configDir: badConfigDir, fixtureDir, expectSuccess: false });
  await assertCountsUnchanged(member.id, countsBeforeBadToken);
  await assertGlobalCountsUnchanged(globalCountsBeforeBadToken);

  console.log("Sync E2E passed.");
} finally {
  await prisma.$disconnect();
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

async function waitForHealth() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(`${serverUrl}/api/cli/health`);
      if (response.ok) {
        console.log("Health check passed.");
        return;
      }
    } catch {
      // Server is still starting.
    }

    await delay(1000);
  }

  throw new Error("Timed out waiting for /api/cli/health.");
}

async function seedMember() {
  const githubId = "sync-e2e-github-id";
  const githubLogin = "sync-e2e-user";
  const githubName = "Sync E2E User";
  const displayName = "Sync E2E User";

  await cleanupPriorE2eData({ githubId, githubLogin });

  const user = await prisma.user.create({
    data: { githubId, githubLogin, githubName },
  });

  return prisma.member.create({
    data: { userId: user.id, username: githubLogin, displayName },
  });
}

async function cleanupPriorE2eData({ githubId, githubLogin }) {
  const e2eUsers = await prisma.user.findMany({
    where: { OR: [{ githubId }, { githubLogin }] },
    select: {
      id: true,
      member: { select: { id: true } },
    },
  });

  const memberIds = e2eUsers.flatMap((user) => (user.member ? [user.member.id] : []));
  if (memberIds.length > 0) {
    await prisma.cliLoginSession.deleteMany({ where: { memberId: { in: memberIds } } });
  }
  await prisma.cliLoginSession.deleteMany({ where: { memberId: null } });

  await prisma.user.deleteMany({
    where: { id: { in: e2eUsers.map((user) => user.id) } },
  });
}

async function runSetupFlow({ memberId, fixtureDir }) {
  const configDir = await makeTempDir("token-burn-setup-config-");
  const schedulerRuntime = await writeFakeSchedulerRuntime();
  const setupResultPromise = run(
    cliBin,
    ["setup", "--server-url", serverUrl],
    {
      HOME: schedulerRuntime.homeDir,
      PATH: `${schedulerRuntime.binDir}${delimiter}${process.env.PATH ?? ""}`,
      TOKEN_BURN_CONFIG_DIR: configDir,
      TOKEN_BURN_E2E_FIXTURE_DIR: fixtureDir,
    },
    setupTimeoutMs,
  );

  await approveNextCliLoginSession(memberId);
  const result = await setupResultPromise;

  if (result.error) {
    throw new Error(`Failed to start token-burn setup: ${result.error}`);
  }

  if (result.timedOut) {
    throw new Error(
      `token-burn setup timed out after ${result.timeoutMs}ms.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }

  if (result.code !== 0) {
    throw new Error(`Expected token-burn setup to pass.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const output = `${result.stdout}\n${result.stderr}`;
  assertIncludes(output, "Starting Token Burn setup.", "setup output should include start message");
  assertIncludes(
    output,
    "Could not open your browser automatically. Open this link in your browser:",
    "setup output should include manual login URL fallback",
  );
  assertNotIncludes(
    output,
    "Waiting for approval. Press Ctrl+C to cancel.",
    "setup output should not obscure manual login URL fallback",
  );
  assertIncludes(output, "Authenticated as sync-e2e-user.", "setup output should authenticate with GitHub username");
  assertIncludes(output, "Submitted 2 usage rows.", "setup output should include first sync summary");
  assertIncludes(output, "First sync complete.", "setup output should include first sync completion");
  assertIncludes(
    output,
    "Installed Token Burn systemd user timer token-burn-sync.timer.",
    "setup output should include scheduler install",
  );
  assertIncludes(
    output,
    "Setup complete. Automatic sync will run every 15 minutes.",
    "setup output should include completion",
  );

  const config = JSON.parse(await readFile(join(configDir, "config.json"), "utf8"));
  assertEqual(config.serverUrl, serverUrl, "setup config serverUrl");
  assertMatches(config.token, /^tb_[A-Za-z0-9._-]+$/, "setup config token");
  assertMatches(config.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "setup config deviceId");
  assertEqual(config.deviceName, expectedDeviceName, "setup config deviceName");
  assertEqual(config.lastSync?.ok, true, "setup config lastSync.ok");
  assertIncludes(config.lastSync?.message ?? "", "Submitted 2 usage rows.", "setup config lastSync message");

  const servicePath = join(schedulerRuntime.homeDir, ".config", "systemd", "user", "token-burn-sync.service");
  const timerPath = join(schedulerRuntime.homeDir, ".config", "systemd", "user", "token-burn-sync.timer");
  const service = await readFile(servicePath, "utf8");
  const timer = await readFile(timerPath, "utf8");
  assertIncludes(service, "ExecStart=", "setup should write systemd service");
  assertIncludes(service, "token-burn sync", "setup scheduler service should run token-burn sync");
  assertIncludes(timer, "OnUnitActiveSec=15min", "setup should write 15 minute systemd timer");

  return { configDir, config };
}

async function approveNextCliLoginSession(memberId) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const session = await prisma.cliLoginSession.findFirst({
      where: {
        memberId: null,
        approvedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (session) {
      await prisma.cliLoginSession.update({
        where: { id: session.id },
        data: { approvedAt: new Date(), memberId },
      });
      return;
    }

    await delay(500);
  }

  throw new Error("Timed out waiting for token-burn setup to create a CLI login session.");
}

async function writeFakeSchedulerRuntime() {
  const homeDir = await makeTempDir("token-burn-scheduler-home-");
  const binDir = await makeTempDir("token-burn-scheduler-bin-");

  if (process.platform === "linux") {
    await writeExecutable(
      join(binDir, "systemctl"),
      ["#!/bin/sh", `printf '%s\\n' "$*" >> ${shellQuote(join(homeDir, "systemctl.log"))}`, "exit 0", ""].join("\n"),
    );
    return { binDir, homeDir };
  }

  if (process.platform === "darwin") {
    await writeExecutable(
      join(binDir, "launchctl"),
      ["#!/bin/sh", `printf '%s\\n' "$*" >> ${shellQuote(join(homeDir, "launchctl.log"))}`, "exit 0", ""].join("\n"),
    );
    return { binDir, homeDir };
  }

  throw new Error(`Setup E2E scheduler isolation does not support ${process.platform}.`);
}

async function writeExecutable(path, content) {
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
}

async function writeFixtures() {
  const dir = await makeTempDir("token-burn-fixtures-");

  await writeFile(
    join(dir, "claude_code.json"),
    JSON.stringify({
      daily: [
        {
          cacheCreationTokens: 300,
          cacheReadTokens: 400,
          costMetadata: { currency: "USD", pricingVersion: "e2e-claude" },
          costUSD: 1.234567,
          date: expectedDate,
          inputTokens: 100,
          models: {
            "claude-haiku-3.5": {
              cacheCreationTokens: 100,
              cacheReadTokens: 100,
              costUSD: 0.345678,
              inputTokens: 50,
              outputTokens: 150,
              totalTokens: 400,
            },
            "claude-sonnet-4": {
              cacheCreationTokens: 200,
              cacheReadTokens: 300,
              costUSD: 0.888889,
              inputTokens: 50,
              outputTokens: 50,
              totalTokens: 600,
            },
          },
          outputTokens: 200,
          totalTokens: 1000,
        },
      ],
    }),
    "utf8",
  );

  await writeFile(
    join(dir, "codex.json"),
    JSON.stringify([
      {
        cachedInputTokens: 300,
        costMetadata: { currency: "USD", pricingVersion: "e2e-codex" },
        costUSD: 0.654321,
        date: expectedDate,
        inputTokens: 100,
        models: [
          {
            cachedInputTokens: 250,
            costUSD: 0.444444,
            inputTokens: 75,
            isFallback: false,
            model: "gpt-5.5",
            outputTokens: 125,
            reasoningOutputTokens: 50,
            totalTokens: 450,
          },
          {
            cachedInputTokens: 50,
            costUSD: 0.111111,
            inputTokens: 25,
            isFallback: true,
            model: "gpt-5.5-mini",
            outputTokens: 75,
            totalTokens: 150,
          },
        ],
        outputTokens: 200,
        reasoningOutputTokens: 50,
        totalTokens: 600,
      },
    ]),
    "utf8",
  );

  console.log(`Fixture providers: ${Object.keys(expectedProviders).join(", ")} on ${expectedDate}`);
  return dir;
}

async function writeAuthenticatedConfig(token, { deviceId }) {
  const dir = await makeTempDir("token-burn-config-");
  const config = {
    serverUrl,
    token,
    deviceId,
    deviceName: expectedDeviceName,
  };

  await writeFile(join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return dir;
}

async function runSync({ configDir, fixtureDir, expectSuccess }) {
  const result = await run(cliBin, ["sync"], {
    TOKEN_BURN_CONFIG_DIR: configDir,
    TOKEN_BURN_E2E_FIXTURE_DIR: fixtureDir,
  });

  if (result.error) {
    throw new Error(`Failed to start token-burn sync: ${result.error}`);
  }

  if (result.timedOut) {
    throw new Error(
      `token-burn sync timed out after ${result.timeoutMs}ms.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }

  if (expectSuccess && result.code !== 0) {
    throw new Error(`Expected token-burn sync to pass.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  if (!expectSuccess && result.code === 0) {
    throw new Error("Expected token-burn sync with a bad token to fail.");
  }

  if (!expectSuccess && !`${result.stdout}\n${result.stderr}`.includes("Unauthorized")) {
    throw new Error(`Expected bad-token sync output to mention Unauthorized.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

async function assertDatabaseState({ memberId, expectedDeviceId, expectedLastSyncCount }) {
  const device = await prisma.device.findUnique({
    where: {
      memberId_clientDeviceId: {
        memberId,
        clientDeviceId: expectedDeviceId,
      },
    },
  });

  assert(device, "Expected synced device row.");
  assertEqual(device.name, expectedDeviceName, "device name");
  assertEqual(device.os, expectedOs, "device os");
  assert(device.lastSeenAt instanceof Date, "Expected device lastSeenAt.");

  const usageRows = await prisma.dailyProviderUsage.findMany({
    where: { memberId },
    include: { models: true },
    orderBy: [{ provider: "asc" }],
  });

  assertEqual(usageRows.length, 2, "provider row count");

  for (const usage of usageRows) {
    const expected = expectedProviders[usage.provider];
    assert(expected, `Unexpected provider ${usage.provider}.`);
    assertEqual(formatDate(usage.date), expectedDate, `${usage.provider} date`);
    assertEqual(Number(usage.totalTokens), expected.totalTokens, `${usage.provider} totalTokens`);
    assertJsonEqual(usage.tokenCategories, expected.tokenCategories, `${usage.provider} tokenCategories`);
    assertJsonEqual(dbNullToNull(usage.tokenDetails), expected.tokenDetails, `${usage.provider} tokenDetails`);
    assertEqual(usage.costUsd?.toFixed(6), expected.costUsd, `${usage.provider} costUsd`);
    assertEqual(usage.costSource, "ccusage", `${usage.provider} costSource`);
    assertJsonEqual(usage.costMetadata, expected.costMetadata, `${usage.provider} costMetadata`);
    assertJsonEqual(dbNullToNull(usage.sourceSnapshot), expected.sourceSnapshot, `${usage.provider} sourceSnapshot`);
    assert(usage.cliVersion.length > 0, `${usage.provider} cliVersion should be populated.`);
    assert(usage.ccusageVersion.length > 0, `${usage.provider} ccusageVersion should be populated.`);
    assertEqual(usage.os, expectedOs, `${usage.provider} os`);
    assert(usage.syncedAt instanceof Date, `${usage.provider} syncedAt should be populated.`);
    assertEqual(usage.models.length, expected.models.length, `${usage.provider} model row count`);

    const modelsByName = new Map(usage.models.map((model) => [model.modelName, model]));
    for (const expectedModel of expected.models) {
      const model = modelsByName.get(expectedModel.modelName);
      assert(model, `Expected ${usage.provider} model ${expectedModel.modelName}.`);
      assertEqual(Number(model.totalTokens), expectedModel.totalTokens, `${usage.provider} ${expectedModel.modelName} totalTokens`);
      assertEqual(model.costUsd?.toFixed(6), expectedModel.costUsd, `${usage.provider} ${expectedModel.modelName} costUsd`);
    }
  }

  const cliTokens = await prisma.cliToken.findMany({ where: { memberId } });
  assertEqual(cliTokens.length, 1, "cli token count");
  assert(cliTokens[0].lastUsedAt instanceof Date, "Expected CliToken.lastUsedAt to be updated.");

  const counts = await readCounts(memberId);
  assertEqual(counts.devices, 1, "idempotent device count");
  assertEqual(counts.providerRows, 2, "idempotent provider row count");
  assertEqual(counts.modelRows, 4, "idempotent model row count");
  assertEqual(counts.cliTokens, 1, "idempotent token count");
  console.log(`Database counts after sync ${expectedLastSyncCount}: ${JSON.stringify(counts)}`);
}

async function assertCountsUnchanged(memberId, expected) {
  const actual = await readCounts(memberId);
  assertJsonEqual(actual, expected, "bad-token row counts");
}

async function assertGlobalCountsUnchanged(expected) {
  const actual = await readGlobalCounts();
  assertJsonEqual(actual, expected, "bad-token global row counts");
}

async function readCounts(memberId) {
  const [devices, providerRows, modelRows, cliTokens] = await Promise.all([
    prisma.device.count({ where: { memberId } }),
    prisma.dailyProviderUsage.count({ where: { memberId } }),
    prisma.dailyModelUsage.count({ where: { memberId } }),
    prisma.cliToken.count({ where: { memberId } }),
  ]);

  return { devices, providerRows, modelRows, cliTokens };
}

async function readGlobalCounts() {
  const [devices, providerRows, modelRows, cliTokens] = await Promise.all([
    prisma.device.count(),
    prisma.dailyProviderUsage.count(),
    prisma.dailyModelUsage.count(),
    prisma.cliToken.count(),
  ]);

  return { devices, providerRows, modelRows, cliTokens };
}

async function postJson(path, body) {
  const response = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`POST ${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

function run(command, args, env, timeoutMs = syncTimeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeout;
    let forceKillTimeout;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      resolve({
        ...result,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
      });
    };

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1000);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish({ code: null, error: redactSecrets(error.message), timedOut: false, timeoutMs });
    });
    child.on("close", (code) => {
      finish({ code, timedOut, timeoutMs });
    });
  });
}

function redactSecrets(value) {
  return value.replace(/\btb_[A-Za-z0-9._-]+/g, "tb_[redacted]");
}

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertLocalE2eTargets({ databaseUrl, serverUrl }) {
  const databaseHost = readUrlHost(databaseUrl, "DATABASE_URL");
  const serverHost = readUrlHost(serverUrl, "TOKEN_BURN_E2E_SERVER_URL");

  if (!isLocalHost(databaseHost) || !isLocalHost(serverHost)) {
    throw new Error(
      `Refusing to run destructive sync E2E cleanup outside local targets. DATABASE_URL host: ${databaseHost}; server host: ${serverHost}.`,
    );
  }
}

function readUrlHost(value, label) {
  try {
    return new URL(value).hostname;
  } catch (error) {
    throw new Error(`${label} must be a valid URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isLocalHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function dbNullToNull(value) {
  return value === null ? null : value;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function assertIncludes(actual, expected, label) {
  if (typeof actual !== "string" || !actual.includes(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}.`);
  }
}

function assertNotIncludes(actual, expected, label) {
  if (typeof actual === "string" && actual.includes(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} not to include ${JSON.stringify(expected)}.`);
  }
}

function assertMatches(actual, expected, label) {
  if (typeof actual !== "string" || !expected.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${expected}.`);
  }
}

function assertJsonEqual(actual, expected, label) {
  const actualJson = stableJsonStringify(actual);
  const expectedJson = stableJsonStringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}.`);
  }
}

function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }

  return value;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
