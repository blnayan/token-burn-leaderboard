#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { hostname, platform, tmpdir } from "node:os";
import { join } from "node:path";

const validToken = "token-burn-e2e-valid-token";
const invalidToken = "token-burn-e2e-invalid-token";
const deviceId = "11111111-1111-4111-8111-111111111111";
const fixtureDate = "2026-06-03";
const timeoutMs = 30_000;

const state = {
  acceptedRequests: [],
  rejectedRequests: [],
};

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/api/sync") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const bodyText = await readRequestBody(request);
    const body = parseJson(bodyText);
    const authorization = request.headers.authorization ?? "";
    const received = {
      authorization,
      body,
      method: request.method,
      url: request.url,
    };

    if (authorization !== `Bearer ${validToken}`) {
      state.rejectedRequests.push(received);
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    state.acceptedRequests.push(received);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

const tempDirs = [];

try {
  const serverUrl = await listen(server);

  await runPreflightChecks();
  await runValidSyncScenario(serverUrl);
  await runUnauthenticatedSyncScenario(serverUrl);
  await runInvalidTokenScenario(serverUrl);

  console.log("Cross-platform packaged CLI E2E passed.");
} finally {
  await closeServer(server);
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

async function runPreflightChecks() {
  const configDir = await makeTempDir("token-burn-cli-e2e-preflight-");
  const baseEnv = { TOKEN_BURN_CONFIG_DIR: configDir };

  const version = await runCli(["--version"], { env: baseEnv });
  assertMatches(version.stdout.trim(), /^[0-9]+\.[0-9]+\.[0-9]+/, "token-burn --version should print semver");

  const status = await runCli(["status"], { env: baseEnv });
  assertIncludes(status.stdout, "CLI version:", "status should include CLI version");
  assertIncludes(status.stdout, "Not authenticated.", "status should show unauthenticated state");

  const doctor = await runCli(["doctor"], { env: baseEnv });
  assertIncludes(doctor.stdout, "CLI version:", "doctor should include CLI version");
  assertIncludes(doctor.stdout, "Platform:", "doctor should include platform");
  assertIncludes(doctor.stdout, "Not authenticated.", "doctor should show unauthenticated state");

  const scheduler = await runCli(["install-scheduler", "--dry-run"], { env: baseEnv });
  assertSchedulerOutput(scheduler.stdout);

  const uninstallHelp = await runCli(["uninstall-scheduler", "--help"], { env: baseEnv });
  assertIncludes(
    uninstallHelp.stdout,
    "Remove automatic Token Burn sync",
    "uninstall scheduler help should describe command",
  );

  const devicesHelp = await runCli(["devices", "--help"], { env: baseEnv });
  assertIncludes(devicesHelp.stdout, "List and merge Token Burn devices", "devices help should describe command");
}

async function runValidSyncScenario(serverUrl) {
  const configDir = await makeTempDir("token-burn-cli-e2e-valid-config-");
  const fixtureDir = await makeTempDir("token-burn-cli-e2e-fixtures-");
  await writeFixtures(fixtureDir);
  await writeConfig(configDir, { serverUrl, token: validToken, deviceId });

  const beforeAccepted = state.acceptedRequests.length;
  const result = await runCli(["sync"], {
    env: {
      TOKEN_BURN_CONFIG_DIR: configDir,
      TOKEN_BURN_E2E_FIXTURE_DIR: fixtureDir,
    },
  });

  assertIncludes(result.stdout, "Submitted 2 usage rows.", "valid sync should submit both providers");

  const newRequests = state.acceptedRequests.slice(beforeAccepted);
  assertEqual(newRequests.length, 2, "valid sync should send exactly two accepted requests");
  assertSyncPayloads(newRequests);

  const config = JSON.parse(await readFile(join(configDir, "config.json"), "utf8"));
  assertEqual(config.deviceId, deviceId, "valid sync should preserve stable device ID");
  assertEqual(config.lastSync.ok, true, "valid sync should write successful lastSync");
  assertIncludes(
    config.lastSync.message,
    "Submitted 2 usage rows.",
    "valid sync lastSync should summarize submissions",
  );
}

async function runUnauthenticatedSyncScenario(serverUrl) {
  const configDir = await makeTempDir("token-burn-cli-e2e-unauth-config-");
  const fixtureDir = await makeTempDir("token-burn-cli-e2e-unauth-fixtures-");
  await writeFixtures(fixtureDir);
  await writeConfig(configDir, { serverUrl });

  const beforeAccepted = state.acceptedRequests.length;
  const beforeRejected = state.rejectedRequests.length;
  const result = await runCli(["sync"], {
    env: {
      TOKEN_BURN_CONFIG_DIR: configDir,
      TOKEN_BURN_E2E_FIXTURE_DIR: fixtureDir,
    },
    expectFailure: true,
  });

  assertIncludes(
    combinedOutput(result),
    "Run token-burn login --server-url",
    "unauthenticated sync should tell user how to login",
  );
  assertEqual(state.acceptedRequests.length, beforeAccepted, "unauthenticated sync should not send accepted requests");
  assertEqual(state.rejectedRequests.length, beforeRejected, "unauthenticated sync should not contact the sync server");
}

async function runInvalidTokenScenario(serverUrl) {
  const configDir = await makeTempDir("token-burn-cli-e2e-invalid-config-");
  const fixtureDir = await makeTempDir("token-burn-cli-e2e-invalid-fixtures-");
  await writeFixtures(fixtureDir);
  await writeConfig(configDir, { serverUrl, token: invalidToken, deviceId });

  const beforeAccepted = state.acceptedRequests.length;
  const beforeRejected = state.rejectedRequests.length;
  const result = await runCli(["sync"], {
    env: {
      TOKEN_BURN_CONFIG_DIR: configDir,
      TOKEN_BURN_E2E_FIXTURE_DIR: fixtureDir,
    },
    expectFailure: true,
  });

  assertIncludes(combinedOutput(result), "Unauthorized", "invalid token sync should surface server Unauthorized response");
  assertEqual(state.acceptedRequests.length, beforeAccepted, "invalid token sync should not send accepted requests");
  assertEqual(
    state.rejectedRequests.length - beforeRejected,
    2,
    "invalid token sync should send two rejected provider requests",
  );
}

async function writeFixtures(fixtureDir) {
  await writeFile(
    join(fixtureDir, "claude_code.json"),
    `${JSON.stringify(
      {
        daily: [
          {
            date: fixtureDate,
            inputTokens: 1000,
            outputTokens: 200,
            cacheCreationTokens: 30,
            cacheReadTokens: 70,
            totalTokens: 1300,
            totalCost: 0.12,
            modelBreakdowns: {
              "claude-sonnet-4": {
                inputTokens: 1000,
                outputTokens: 200,
                cacheCreationTokens: 30,
                cacheReadTokens: 70,
                totalTokens: 1300,
                totalCost: 0.12,
              },
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(
    join(fixtureDir, "codex.json"),
    `${JSON.stringify(
      [
        {
          date: fixtureDate,
          inputTokens: 500,
          outputTokens: 300,
          cachedInputTokens: 200,
          reasoningOutputTokens: 50,
          totalTokens: 1000,
          costUSD: 0.34,
          models: [
            {
              model: "gpt-5.1",
              inputTokens: 500,
              outputTokens: 300,
              cachedInputTokens: 200,
              reasoningOutputTokens: 50,
              totalTokens: 1000,
              costUSD: 0.34,
              isFallback: false,
            },
          ],
        },
      ],
      null,
      2,
    )}\n`,
  );
}

async function writeConfig(configDir, config) {
  await writeFile(join(configDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function assertSyncPayloads(requests) {
  const byProvider = new Map(requests.map((request) => [request.body.provider, request.body]));
  const claude = byProvider.get("claude_code");
  const codex = byProvider.get("codex");

  assert(claude, "expected claude_code sync payload");
  assert(codex, "expected codex sync payload");

  assertCommonPayload(claude, "claude_code");
  assertTokenCategories(
    claude.tokenCategories,
    { input: 1000, output: 200, cacheCreate: 30, cacheRead: 70 },
    "claude token categories",
  );
  assertEqual(claude.tokenDetails, undefined, "claude token details should be omitted");
  assertEqual(claude.totalTokens, 1300, "claude total tokens");
  assertEqual(claude.costUsd, 0.12, "claude cost");
  assertEqual(claude.costSource, "ccusage", "claude cost source");
  assertEqual(claude.models.length, 1, "claude model row count");
  assertEqual(claude.models[0].modelName, "claude-sonnet-4", "claude model name");
  assertTokenCategories(
    claude.models[0].tokenCategories,
    { input: 1000, output: 200, cacheCreate: 30, cacheRead: 70 },
    "claude model token categories",
  );
  assertEqual(claude.models[0].tokenDetails, undefined, "claude model token details should be omitted");
  assertEqual(claude.models[0].totalTokens, 1300, "claude model total tokens");
  assertEqual(claude.models[0].costUsd, 0.12, "claude model cost");
  assertEqual(claude.models[0].metadata, undefined, "claude model metadata should be omitted");
  assertDeepEqual(
    claude.sourceSnapshot,
    {
      cacheCreationTokens: 30,
      cacheReadTokens: 70,
      inputTokens: 1000,
      outputTokens: 200,
      totalCost: 0.12,
      totalTokens: 1300,
    },
    "claude source snapshot",
  );

  assertCommonPayload(codex, "codex");
  assertTokenCategories(
    codex.tokenCategories,
    { input: 500, output: 300, cacheCreate: 0, cacheRead: 200 },
    "codex token categories",
  );
  assertDeepEqual(codex.tokenDetails, { reasoningOutput: 50 }, "codex token details");
  assertEqual(codex.totalTokens, 1000, "codex total tokens");
  assertEqual(codex.costUsd, 0.34, "codex cost");
  assertEqual(codex.costSource, "ccusage", "codex cost source");
  assertEqual(codex.models.length, 1, "codex model row count");
  assertEqual(codex.models[0].modelName, "gpt-5.1", "codex model name");
  assertTokenCategories(
    codex.models[0].tokenCategories,
    { input: 500, output: 300, cacheCreate: 0, cacheRead: 200 },
    "codex model token categories",
  );
  assertDeepEqual(codex.models[0].tokenDetails, { reasoningOutput: 50 }, "codex model token details");
  assertEqual(codex.models[0].totalTokens, 1000, "codex model total tokens");
  assertEqual(codex.models[0].costUsd, 0.34, "codex model cost");
  assertEqual(codex.models[0].metadata.isFallback, false, "codex model fallback metadata");
  assertDeepEqual(
    codex.sourceSnapshot,
    {
      cachedInputTokens: 200,
      costUSD: 0.34,
      inputTokens: 500,
      outputTokens: 300,
      reasoningOutputTokens: 50,
      totalTokens: 1000,
    },
    "codex source snapshot",
  );
}

function assertCommonPayload(payload, provider) {
  assertEqual(payload.provider, provider, `${provider} provider`);
  assertEqual(payload.date, fixtureDate, `${provider} date`);
  assertEqual(payload.deviceId, deviceId, `${provider} device ID`);
  assert(
    typeof payload.deviceName === "string" && payload.deviceName.length > 0,
    `${provider} device name should be non-empty`,
  );
  assertEqual(payload.deviceName, normalizeDeviceName(hostname()), `${provider} device name should use OS hostname`);
  assertMatches(payload.cliVersion, /^[0-9]+\.[0-9]+\.[0-9]+/, `${provider} CLI version should be semver`);
  assertMatches(payload.ccusageVersion, /^[0-9]+\.[0-9]+\.[0-9]+/, `${provider} ccusage version should be semver`);
  assertEqual(payload.os, normalizePlatform(platform()), `${provider} OS should match current platform`);
  assertMatches(payload.syncedAt, /^\d{4}-\d{2}-\d{2}T/, `${provider} syncedAt should be ISO-like datetime`);
}

function assertTokenCategories(actual, expected, message) {
  assertDeepEqual(actual, expected, message);
}

function assertSchedulerOutput(output) {
  const os = process.env.RUNNER_OS || normalizeRunnerOs(platform());

  if (os === "Linux") {
    assertIncludes(output, "token-burn-sync.service", "Linux scheduler dry-run should include systemd service");
    assertIncludes(output, "token-burn-sync.timer", "Linux scheduler dry-run should include systemd timer");
    assertIncludes(output, "# Cron fallback", "Linux scheduler dry-run should include cron fallback");
    return;
  }

  if (os === "macOS") {
    assertIncludes(output, "com.token-burn.sync", "macOS scheduler dry-run should include launchd label");
    assertIncludes(output, "StartInterval", "macOS scheduler dry-run should include StartInterval");
    assertIncludes(output, "900", "macOS scheduler dry-run should sync every 900 seconds");
    return;
  }

  if (os === "Windows") {
    assertIncludes(output, "schtasks", "Windows scheduler dry-run should include schtasks");
    assertIncludes(output, "/TN TokenBurnSync", "Windows scheduler dry-run should include task name");
    assertIncludes(output, "/SC MINUTE", "Windows scheduler dry-run should include minute schedule");
    assertIncludes(output, "/MO 15", "Windows scheduler dry-run should include 15 minute interval");
    return;
  }

  throw new Error(`Unsupported runner OS for scheduler assertions: ${os}`);
}

function runCli(args, { env = {}, expectFailure = false } = {}) {
  const command = process.platform === "win32" ? "token-burn.cmd" : "token-burn";

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`token-burn ${args.join(" ")} timed out after ${timeoutMs}ms`));
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
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = { code, stdout, stderr };
      if (expectFailure) {
        if (code === 0) {
          reject(new Error(`Expected token-burn ${args.join(" ")} to fail. Output:\n${redact(combinedOutput(result))}`));
          return;
        }
        resolve(result);
        return;
      }

      if (code !== 0) {
        reject(new Error(`token-burn ${args.join(" ")} exited with ${code}. Output:\n${redact(combinedOutput(result))}`));
        return;
      }

      resolve(result);
    });
  });
}

async function listen(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine fake server address."));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function closeServer(httpServer) {
  await new Promise((resolve) => {
    httpServer.close(() => resolve());
  });
}

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("error", reject);
    request.on("end", () => resolve(body));
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected request body to be JSON: ${error.message}`);
  }
}

function normalizeRunnerOs(value) {
  if (value === "linux") return "Linux";
  if (value === "darwin") return "macOS";
  if (value === "win32") return "Windows";
  return value;
}

function normalizePlatform(value) {
  if (value === "darwin" || value === "linux" || value === "win32") return value;
  throw new Error(`Unsupported platform: ${value}`);
}

function normalizeDeviceName(value) {
  const trimmed = value.trim();
  return trimmed || "Unknown device";
}

function combinedOutput(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function redact(value) {
  return value.replaceAll(validToken, "[REDACTED_TOKEN]").replaceAll(invalidToken, "[REDACTED_TOKEN]");
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(`${message}: expected output to include ${JSON.stringify(needle)}. Output:\n${redact(haystack)}`);
  }
}

function assertMatches(value, pattern, message) {
  if (!pattern.test(value)) {
    throw new Error(`${message}: ${JSON.stringify(value)} did not match ${pattern}`);
  }
}
