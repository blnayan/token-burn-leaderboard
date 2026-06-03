#!/usr/bin/env bash
set -euo pipefail

tarball="${1:?Usage: $0 <token-burn-tarball.tgz>}"
image="${TOKEN_BURN_DOCKER_NODE_IMAGE:-node:24-bookworm}"

tarball_path="$(cd "$(dirname "$tarball")" && pwd -P)/$(basename "$tarball")"

docker run --rm \
  -v "${tarball_path}:/tmp/token-burn.tgz:ro" \
  "${image}" \
  bash -lc 'set -euo pipefail
    npm install -g /tmp/token-burn.tgz
    su node -c "token-burn --version"
    su node -c "token-burn status"
    node - <<'"'"'NODE'"'"'
const fs = require("node:fs");
const path = require("node:path");

const ccusageRoot = "/usr/local/lib/node_modules/@blnayan/token-burn/node_modules/@ccusage";
const binaries = [];

for (const packageName of fs.readdirSync(ccusageRoot)) {
  const binaryPath = path.join(ccusageRoot, packageName, "bin", "ccusage");
  if (!fs.existsSync(binaryPath)) continue;

  const mode = fs.statSync(binaryPath).mode & 0o777;
  console.log(`${binaryPath} ${mode.toString(8)}`);

  if ((mode & 0o111) !== 0o111) {
    throw new Error(`${binaryPath} is not executable`);
  }

  binaries.push(binaryPath);
}

if (binaries.length === 0) {
  throw new Error("No ccusage native binary found");
}
NODE'
