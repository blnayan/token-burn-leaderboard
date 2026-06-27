import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const builtPostinstallPath = join(packageRoot, "dist", "postinstall.js");

if (existsSync(builtPostinstallPath)) {
  const { runPostinstallCompatibilityHook } = await import(pathToFileURL(builtPostinstallPath).href);
  await runPostinstallCompatibilityHook();
}
