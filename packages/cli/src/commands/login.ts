import { Command } from "commander";
import { z } from "zod";

import type { CliConfig } from "../config.js";
import { writeConfig as writeConfigFile } from "../config.js";
import { postJson as postJsonRequest } from "../http.js";

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
    member: z.object({ displayName: z.string().min(1) }),
  }),
]);

export type LoginDependencies = {
  postJson?: <T>(url: string, body: unknown, token?: string) => Promise<T>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  log?: (message: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
};

export type LoginOptions = LoginDependencies & {
  serverUrl: string;
};

export async function runLogin({
  serverUrl,
  postJson = postJsonRequest,
  writeConfig = writeConfigFile,
  log = console.log,
  sleep = defaultSleep,
  now = () => new Date(),
}: LoginOptions): Promise<void> {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const startResponse = loginStartResponseSchema.parse(
    await postJson(`${normalizedServerUrl}/api/cli/login/start`, {}),
  );
  const expiresAt = new Date(startResponse.expiresAt);

  log(startResponse.loginUrl);
  log("Waiting for approval. Press Ctrl+C to cancel.");

  while (now().getTime() < expiresAt.getTime()) {
    const pollResponse = loginPollResponseSchema.parse(
      await postJson(`${normalizedServerUrl}/api/cli/login/poll`, { pollToken: startResponse.pollToken }),
    );

    if (pollResponse.status === "approved") {
      await writeConfig({ serverUrl: normalizedServerUrl, token: pollResponse.token });
      log(`Authenticated as ${pollResponse.member.displayName}.`);
      return;
    }

    await sleep(3_000);
  }

  throw new Error("Login session expired before approval.");
}

export function createLoginCommand(): Command {
  return new Command("login")
    .description("Authenticate the Token Burn CLI")
    .option(
      "-s, --server <url>, --server-url <url>",
      "Token Burn server URL",
      process.env.TOKEN_BURN_SERVER_URL ?? "http://localhost:3000",
    )
    .action(async (options: { server: string }) => {
      await runLogin({ serverUrl: options.server });
    });
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
