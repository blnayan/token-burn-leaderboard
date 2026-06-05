import { Command } from "commander";

import type { CliConfig } from "../config.js";
import { readConfig as readConfigFile, writeConfig as writeConfigFile } from "../config.js";
import { resolveOutputMode, type OutputFlags } from "../ui/mode.js";
import { createPlainRenderer } from "../ui/plain-renderer.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";

export type LogoutDependencies = {
  readConfig?: () => Promise<CliConfig | null>;
  writeConfig?: (config: CliConfig) => Promise<void>;
  log?: (message: string) => void;
  ui?: UiRenderer;
};

export type LogoutResult = {
  wasAuthenticated: boolean;
  serverUrl?: string;
};

export async function runLogout({
  readConfig = readConfigFile,
  writeConfig = writeConfigFile,
  log,
  ui,
}: LogoutDependencies = {}): Promise<LogoutResult> {
  const renderer = ui ?? (log ? createLegacyLogRenderer(log) : createRenderer(resolveOutputMode({ flags: {} })));
  const config = await readConfig();

  if (!config) {
    const result = { wasAuthenticated: false };
    renderer.warning("auth", "Not authenticated");
    renderer.result({ ok: true, ...result });
    return result;
  }

  const loggedOutConfig: CliConfig = {
    serverUrl: config.serverUrl,
    ...(config.lastSync ? { lastSync: config.lastSync } : {}),
  };

  await writeConfig(loggedOutConfig);
  const result = { serverUrl: config.serverUrl, wasAuthenticated: true };
  renderer.success("auth", "Logged out");
  renderer.result({ ok: true, ...result });
  return result;
}

export function createLogoutCommand(): Command {
  const command = new Command("logout").description("Remove local Token Burn CLI credentials").action(async () => {
    const flags = command.parent?.opts<OutputFlags>() ?? {};
    await runLogout({ ui: createRenderer(resolveOutputMode({ flags })) });
  });

  return command;
}

function createLegacyLogRenderer(log: (message: string) => void): UiRenderer {
  return {
    ...createPlainRenderer({ write: log }),
    result() {},
  };
}
