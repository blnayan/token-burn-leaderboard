#!/usr/bin/env bash
set -euo pipefail

runner_os="${RUNNER_OS:-}"
if [[ -z "$runner_os" ]]; then
  case "$(uname -s)" in
    Linux*) runner_os="Linux" ;;
    Darwin*) runner_os="macOS" ;;
    MINGW* | MSYS* | CYGWIN*) runner_os="Windows" ;;
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

config_dir="$(mktemp -d)"
export TOKEN_BURN_CONFIG_DIR="$config_dir"

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

if TOKEN_BURN_CONFIG_DIR="$config_dir" token-burn sync >"$config_dir/sync.out" 2>"$config_dir/sync.err"; then
  printf 'Expected unauthenticated token-burn sync to fail.\n' >&2
  cat "$config_dir/sync.out" >&2
  cat "$config_dir/sync.err" >&2
  exit 1
fi

sync_output="$(cat "$config_dir/sync.out" "$config_dir/sync.err")"
assert_contains "$sync_output" "Run token-burn login --server-url"
