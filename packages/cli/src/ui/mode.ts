export type OutputMode = "rich" | "plain" | "json";

export type OutputFlags = {
  color?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
};

export type OutputModeConfig = {
  color: boolean;
  mode: OutputMode;
  quiet: boolean;
};

type OutputModeEnv = Partial<Record<"CI" | "NO_COLOR" | "TOKEN_BURN_OUTPUT", string | undefined>>;

export function resolveOutputMode({
  stdoutIsTTY = Boolean(process.stdout.isTTY),
  env = process.env,
  flags,
}: {
  stdoutIsTTY?: boolean;
  env?: OutputModeEnv;
  flags: OutputFlags;
}): OutputModeConfig {
  if (flags.json) {
    return { color: false, mode: "json", quiet: flags.quiet === true };
  }

  if (flags.plain) {
    return { color: false, mode: "plain", quiet: flags.quiet === true };
  }

  if (env.TOKEN_BURN_OUTPUT === "json") {
    return { color: false, mode: "json", quiet: flags.quiet === true };
  }

  if (env.TOKEN_BURN_OUTPUT === "plain") {
    return { color: false, mode: "plain", quiet: flags.quiet === true };
  }

  if (!stdoutIsTTY || env.NO_COLOR || env.CI) {
    return { color: false, mode: "plain", quiet: flags.quiet === true };
  }

  return {
    color: flags.color !== false,
    mode: "rich",
    quiet: flags.quiet === true,
  };
}
