import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { Command } from "commander";
import { z } from "zod";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile, writeConfig as writeConfigFile } from "../config.js";
import { defaultServerUrl } from "../defaults.js";
import { postJson as postJsonRequest } from "../http.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createPlainRenderer } from "../ui/plain-renderer.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";

const loginStartResponseSchema = z.object({
  loginUrl: z.string().url(),
  pollToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

const loginPollResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("approved"),
    token: z.string().min(1),
    member: z.object({
      displayName: z.string().min(1),
      username: z.string().min(1).optional(),
    }),
  }),
]);

export type LoginDependencies = {
  postJson?: <T>(url: string, body: unknown, token?: string) => Promise<T>;
  readConfig?: () => Promise<CliConfig | null>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  log?: (message: string) => void;
  ui?: UiRenderer;
  openBrowser?: (url: string) => Promise<void>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  emitPendingApprovalResult?: boolean;
};

export type LoginResult = {
  authenticatedAs: string;
  serverUrl: string;
};

export type LoginOptions = LoginDependencies & {
  serverUrl: string;
};

export async function runLogin({
  serverUrl,
  postJson = postJsonRequest,
  readConfig = readConfigFile,
  writeConfig = writeConfigFile,
  log,
  ui,
  openBrowser = openDefaultBrowser,
  sleep = defaultSleep,
  now = () => new Date(),
  emitPendingApprovalResult = false,
}: LoginOptions): Promise<LoginResult> {
  const renderer = ui ?? (log ? createPlainRenderer({ write: log }) : createRenderer(resolveOutputMode({ flags: {} })));
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const existingConfig = await readConfig();
  const startResponse = loginStartResponseSchema.parse(
    await postJson(`${normalizedServerUrl}/api/cli/login/start`, {}),
  );
  const expiresAt = new Date(startResponse.expiresAt);

  if (emitPendingApprovalResult) {
    renderer.result({
      ok: true,
      status: "pending_approval",
      loginUrl: startResponse.loginUrl,
      serverUrl: normalizedServerUrl,
      expiresAt: startResponse.expiresAt,
    });
  }

  try {
    await openBrowser(startResponse.loginUrl);
    renderer.step("login", "Opening approval link in your browser");
    renderer.info("Waiting for approval. Press Ctrl+C to cancel.");
  } catch {
    renderer.warning("browser", "Could not open your browser automatically");
    renderer.nextAction(`Open this link in your browser: ${startResponse.loginUrl}`);
  }

  while (now().getTime() < expiresAt.getTime()) {
    const pollResponse = loginPollResponseSchema.parse(
      await postJson(`${normalizedServerUrl}/api/cli/login/poll`, { pollToken: startResponse.pollToken }),
    );

    if (pollResponse.status === "approved") {
      await writeConfig({
        serverUrl: normalizedServerUrl,
        token: pollResponse.token,
        ...(existingConfig?.deviceId ? { deviceId: existingConfig.deviceId } : {}),
        ...(existingConfig?.deviceName ? { deviceName: existingConfig.deviceName } : {}),
      });
      const authenticatedAs = pollResponse.member.username ?? pollResponse.member.displayName;
      const result = { authenticatedAs, serverUrl: normalizedServerUrl };
      renderer.success("login", `Authenticated as ${authenticatedAs}`);
      renderer.result({ ok: true, authenticatedAs, serverUrl: normalizedServerUrl });
      return result;
    }

    await sleep(3_000);
  }

  throw new Error("Login session expired before approval.");
}

export function createLoginCommand(): Command {
  const command = new Command("login")
    .description("Authenticate the Token Burn CLI")
    .option(
      "-s, --server-url <url>",
      "Token Burn server URL",
    )
    .option("--server <url>", "Alias for --server-url")
    .action(async (options: { serverUrl?: string; server?: string }) => {
      const flags = command.parent?.opts<OutputFlags>() ?? {};
      await runLogin({
        serverUrl: options.serverUrl ?? options.server ?? defaultServerUrl(),
        ui: createRenderer(resolveOutputMode({ flags })),
        emitPendingApprovalResult: flags.json === true,
      });
    });

  return command;
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

const execFileAsync = promisify(execFileCallback);

async function openDefaultBrowser(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("open", [url]);
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", url]);
    return;
  }

  await execFileAsync("xdg-open", [url]);
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
