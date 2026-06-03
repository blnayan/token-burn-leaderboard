import { chmod, readdir, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

type SupportedPlatform = NodeJS.Platform | "win32";

type FixOptions = {
  rootDir?: string;
  platform?: SupportedPlatform;
  warn?: (message: string) => void;
};

export async function fixCcusageNativeBinaryPermissions({
  rootDir = packageRootFromImportUrl(import.meta.url),
  platform = process.platform,
  warn = console.warn,
}: FixOptions = {}): Promise<string[]> {
  if (platform === "win32") {
    return [];
  }

  const ccusageRoot = join(rootDir, "node_modules", "@ccusage");
  let packageNames: string[];

  try {
    packageNames = await readdir(ccusageRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw error;
  }

  const fixed: string[] = [];

  for (const packageName of packageNames) {
    const binaryPath = join(ccusageRoot, packageName, "bin", "ccusage");

    try {
      const binaryStat = await stat(binaryPath);

      if (!binaryStat.isFile()) {
        continue;
      }

      if ((binaryStat.mode & 0o111) !== 0o111) {
        await chmod(binaryPath, 0o755);
      }

      fixed.push(binaryPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        continue;
      }

      warn(`Token Burn could not make ${binaryPath} executable: ${errorMessage(error)}`);
    }
  }

  return fixed;
}

function packageRootFromImportUrl(importUrl: string): string {
  return dirname(dirname(fileURLToPath(importUrl)));
}

function isMissingPathError(error: unknown): boolean {
  return isNodeError(error) && error.code === "ENOENT";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await fixCcusageNativeBinaryPermissions();
}
