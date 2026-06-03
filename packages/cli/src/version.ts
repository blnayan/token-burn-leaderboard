import { readFileSync } from "node:fs";

export const cliVersion = readCliVersion();

function readCliVersion(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Unable to determine CLI version.");
  }

  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || !version) {
    throw new Error("Unable to determine CLI version.");
  }

  return version;
}
