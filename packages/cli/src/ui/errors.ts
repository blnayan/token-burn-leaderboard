import type { UiError } from "./types.js";

export function classifyError(error: unknown): UiError {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("to authenticate")) {
    return { code: "AUTH_REQUIRED", message, nextAction: "token-burn login" };
  }

  if (message.startsWith("Token Burn requires token-burn")) {
    return { code: "CLI_VERSION_REQUIRED", message, nextAction: "npm install -g @blnayan/token-burn@latest" };
  }

  if (message.includes("ccusage native binary is not executable")) {
    return { code: "CCUSAGE_BINARY_PERMISSION", message };
  }

  if (message.includes("automatic sync was not installed") || message.includes("scheduler")) {
    return { code: "SCHEDULER_ERROR", message };
  }

  if (message.includes("Device check failed") || message.includes("Cannot merge devices")) {
    return { code: "DEVICE_ERROR", message };
  }

  return { code: "CLI_ERROR", message };
}
