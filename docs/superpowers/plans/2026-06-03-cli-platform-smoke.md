# CLI Platform Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-platform packed CLI smoke coverage for Linux, macOS, and Windows, including scheduler dry-run and unauthenticated sync checks.

**Architecture:** Add a reusable Bash script that validates the installed packed CLI and asserts OS-specific scheduler dry-run output using `RUNNER_OS` or `uname`. Wire the script into the existing GitHub Actions OS matrix after global install. Keep the Linux Docker root/global install smoke as the separate sudo-style check.

**Tech Stack:** Bash, GitHub Actions, pnpm, npm packed tarballs, Vitest for existing CLI unit coverage.

---

## File Structure

- `scripts/smoke-cli-cross-platform.sh`: new reusable smoke script run after packed global install on Ubuntu, macOS, and Windows.
- `.github/workflows/cli-smoke.yml`: update the matrix job to run the cross-platform smoke script instead of only `token-burn --version` and `token-burn status`.
- `docs/superpowers/specs/2026-06-03-cli-platform-smoke-design.md`: design record for the chosen test strategy.
- `docs/superpowers/plans/2026-06-03-cli-platform-smoke.md`: this implementation plan.

### Task 1: Add Cross-Platform CLI Smoke Script

**Files:**
- Create: `scripts/smoke-cli-cross-platform.sh`

- [ ] **Step 1: Create the smoke script**

Create `scripts/smoke-cli-cross-platform.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

runner_os="${RUNNER_OS:-}"
if [[ -z "$runner_os" ]]; then
  case "$(uname -s)" in
    Linux*) runner_os="Linux" ;;
    Darwin*) runner_os="macOS" ;;
    MINGW*|MSYS*|CYGWIN*) runner_os="Windows" ;;
    *) runner_os="$(uname -s)" ;;
  esac
fi

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if [[ "$haystack" != *"$needle"* ]]; then
    printf 'Expected output to contain: %s\nActual output:\n%s\n' "$needle" "$haystack" >&2
    exit 1
  fi
}

version_output="$(token-burn --version)"
if [[ ! "$version_output" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  printf 'Expected token-burn --version to print semver, got: %s\n' "$version_output" >&2
  exit 1
fi

status_output="$(token-burn status)"
assert_contains "$status_output" "CLI version:"
assert_contains "$status_output" "Not authenticated."

doctor_output="$(token-burn doctor)"
assert_contains "$doctor_output" "CLI version:"
assert_contains "$doctor_output" "Not authenticated."
assert_contains "$doctor_output" "Platform:"
assert_contains "$doctor_output" "Run token-burn sync to submit usage now."

scheduler_output="$(token-burn install-scheduler --dry-run)"
case "$runner_os" in
  Linux)
    assert_contains "$scheduler_output" "token-burn-sync.service"
    assert_contains "$scheduler_output" "token-burn-sync.timer"
    assert_contains "$scheduler_output" "# Cron fallback"
    ;;
  macOS)
    assert_contains "$scheduler_output" "com.token-burn.sync"
    assert_contains "$scheduler_output" "StartInterval"
    assert_contains "$scheduler_output" "900"
    ;;
  Windows)
    assert_contains "$scheduler_output" "schtasks"
    assert_contains "$scheduler_output" "/TN TokenBurnSync"
    assert_contains "$scheduler_output" "/SC MINUTE"
    assert_contains "$scheduler_output" "/MO 15"
    ;;
  *)
    printf 'Unsupported runner OS for smoke assertions: %s\n' "$runner_os" >&2
    exit 1
    ;;
esac

uninstall_help="$(token-burn uninstall-scheduler --help)"
assert_contains "$uninstall_help" "Remove automatic Token Burn sync"

devices_help="$(token-burn devices --help)"
assert_contains "$devices_help" "List and merge Token Burn devices"

config_dir="$(mktemp -d)"
if TOKEN_BURN_CONFIG_DIR="$config_dir" token-burn sync >"$config_dir/sync.out" 2>"$config_dir/sync.err"; then
  printf 'Expected unauthenticated token-burn sync to fail.\n' >&2
  cat "$config_dir/sync.out" >&2
  cat "$config_dir/sync.err" >&2
  exit 1
fi

sync_output="$(cat "$config_dir/sync.out" "$config_dir/sync.err")"
assert_contains "$sync_output" "Run token-burn login --server-url"
```

- [ ] **Step 2: Make the script executable**

Run:

```bash
chmod +x scripts/smoke-cli-cross-platform.sh
```

- [ ] **Step 3: Verify shell syntax**

Run:

```bash
bash -n scripts/smoke-cli-cross-platform.sh
```

Expected: exit 0.

### Task 2: Wire Smoke Script Into GitHub Actions

**Files:**
- Modify: `.github/workflows/cli-smoke.yml`

- [ ] **Step 1: Replace the minimal packed CLI run step**

Change:

```yaml
      - name: Run packed CLI
        shell: bash
        run: |
          token-burn --version
          token-burn status
```

to:

```yaml
      - name: Run packed CLI smoke
        shell: bash
        run: bash scripts/smoke-cli-cross-platform.sh
```

- [ ] **Step 2: Verify workflow references the smoke script and all OS runners**

Run:

```bash
rg -n "smoke-cli-cross-platform|ubuntu-latest|macos-latest|windows-latest|install-scheduler" .github/workflows/cli-smoke.yml scripts/smoke-cli-cross-platform.sh
```

Expected: output includes the new script reference, all three OS runners, and scheduler assertions.

### Task 3: Local Packed CLI Smoke Verification

**Files:**
- Existing changed files only.

- [ ] **Step 1: Build and pack the CLI**

Run:

```bash
rm -rf /tmp/token-burn-ci-pack
mkdir -p /tmp/token-burn-ci-pack
pnpm --filter @blnayan/token-burn build
(cd packages/cli && npm pack --pack-destination /tmp/token-burn-ci-pack)
```

Expected: tarball `blnayan-token-burn-0.1.5.tgz` is created.

- [ ] **Step 2: Run existing Linux root/global install smoke**

Run:

```bash
scripts/smoke-cli-linux-root-global-install.sh /tmp/token-burn-ci-pack/blnayan-token-burn-0.1.5.tgz
```

Expected: exit 0 and output includes `token-burn` version, unauthenticated status, and a `ccusage` binary mode of `755`.

- [ ] **Step 3: Run cross-platform smoke locally on Linux**

Run:

```bash
scripts/smoke-cli-cross-platform.sh
```

Expected: exit 0 against the locally available `token-burn` binary.

### Task 4: Final Verification And Commit

**Files:**
- Existing changed files only.

- [ ] **Step 1: Run CLI tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test
```

Expected: all CLI tests pass.

- [ ] **Step 2: Run CLI typecheck with shared package built**

Run:

```bash
pnpm --filter @token-burn/shared build
pnpm --filter @blnayan/token-burn typecheck
```

Expected: both commands exit 0.

- [ ] **Step 3: Commit changes**

Run:

```bash
git add .github/workflows/cli-smoke.yml scripts/smoke-cli-cross-platform.sh docs/superpowers/specs/2026-06-03-cli-platform-smoke-design.md docs/superpowers/plans/2026-06-03-cli-platform-smoke.md
git commit -m "ci: add platform-specific cli smoke checks"
```

- [ ] **Step 4: Push and check GitHub Actions**

Run:

```bash
git push origin main
gh run watch <new-run-id> --repo blnayan/token-burn-leaderboard --exit-status
```

Expected: `CLI Smoke` succeeds on Ubuntu, macOS, Windows, and the Linux Docker root/global install smoke job.

## Self-Review

- Spec coverage: The plan adds platform-specific scheduler dry-run assertions, basic command smoke checks, unauthenticated sync failure checks, and keeps the existing Docker root/global install coverage.
- Placeholder scan: No TODO/TBD placeholders remain.
- Type consistency: Script names and workflow references match exactly.
