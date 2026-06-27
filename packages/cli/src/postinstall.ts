import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function runPostinstallCompatibilityHook(): Promise<void> {
  return undefined;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runPostinstallCompatibilityHook();
}
