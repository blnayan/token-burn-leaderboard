import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const builtPostinstallPath = join(packageRoot, "dist", "postinstall.js");

export async function runBuiltPostinstall(path = builtPostinstallPath) {
  if (!existsSync(path)) {
    return;
  }

  const builtPostinstall = await import(pathToFileURL(path).href);
  const hook = builtPostinstall.runPostinstallCompatibilityHook;

  if (typeof hook !== "function") {
    return;
  }

  await hook();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runBuiltPostinstall();
}
