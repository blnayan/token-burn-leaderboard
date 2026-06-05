import type { UiError } from "./types.js";

export function classifyError(error: unknown): UiError {
  const message = toErrorMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (message.includes("to authenticate")) {
    return { code: "AUTH_REQUIRED", message, nextAction: "token-burn login" };
  }

  if (message.startsWith("Token Burn requires token-burn")) {
    return { code: "CLI_VERSION_REQUIRED", message, nextAction: "npm install -g @blnayan/token-burn@latest" };
  }

  if (message.includes("ccusage native binary is not executable")) {
    return { code: "CCUSAGE_BINARY_PERMISSION", message };
  }

  if (
    normalizedMessage.includes("automatic sync was not installed")
    || normalizedMessage.includes("systemd user timer unavailable")
    || normalizedMessage.includes("cron")
    || normalizedMessage.includes("crontab")
  ) {
    return { code: "SCHEDULER_ERROR", message };
  }

  if (message.includes("Device check failed") || message.includes("Cannot merge devices")) {
    return { code: "DEVICE_ERROR", message };
  }

  return { code: "CLI_ERROR", message };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  try {
    return String(error);
  } catch {
    return "Unknown error";
  }
}
