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

const packageRoot = "/usr/local/lib/node_modules/@blnayan/token-burn";
const tokscalePackageJson = path.join(packageRoot, "node_modules", "tokscale", "package.json");

if (!fs.existsSync(tokscalePackageJson)) {
  throw new Error("tokscale package was not installed with token-burn");
}

const tokscalePackage = JSON.parse(fs.readFileSync(tokscalePackageJson, "utf8"));
const bin = typeof tokscalePackage.bin === "string" ? tokscalePackage.bin : tokscalePackage.bin?.tokscale;

if (!bin) {
  throw new Error("tokscale package does not declare a bin");
}

const binPath = path.resolve(path.dirname(tokscalePackageJson), bin);

if (!fs.existsSync(binPath)) {
  throw new Error(`tokscale bin not found at ${binPath}`);
}

console.log(`tokscale ${tokscalePackage.version} ${binPath}`);
NODE'
