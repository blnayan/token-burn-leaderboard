# Token Burn CLI Design System

## Summary

Revamp the Token Burn CLI around a standardized, modern command presentation system. The default interactive experience should use a distinct but restrained "Clean Operator" style: compact, trustworthy, polished, and easy to scan. Every command should use the new design system, while automation remains reliable through plain and JSON output modes.

The implementation should use a Clack-style rich CLI approach with a shared renderer rather than a full Ink app shell. Commander remains the parser, and command behavior stays testable by separating service logic from presentation.

## Goals

- Give every Token Burn command a consistent visual language.
- Make interactive terminal output feel modern without becoming noisy or theatrical.
- Preserve automation safety for cron, logs, non-TTY output, and scripts.
- Support richer command grouping and flags without breaking existing commands.
- Centralize presentation decisions so command files do not scatter colors, symbols, spacing, or string formatting.

## Non-Goals

- Do not replace the entire CLI with a full-screen Ink application.
- Do not remove existing command names during this redesign.
- Do not change sync, auth, scheduler, or device business behavior except where presentation boundaries require structured return values.
- Do not introduce decorative output in non-TTY or automation contexts.

## Recommended Approach

Use Commander for command parsing and add a shared presentation layer under `packages/cli/src/ui/`.

Candidate dependencies:

- `@clack/prompts` for polished prompts, spinners, and step-style interactions.
- `picocolors` or an equivalent small color utility.
- `cli-table3` or a similar table renderer for device and status output.
- `wrap-ansi` for predictable text wrapping in panels and next-action blocks.

This approach gives Token Burn a designed CLI surface while staying lighter and easier to test than an Ink app shell.

## Output Modes

The CLI should choose an output mode at startup and pass it through command execution.

- `rich`: default when stdout is an interactive TTY and no disabling flags or environment variables are present. Uses color, symbols, compact panels, spinners, tables, and step summaries.
- `plain`: default for non-TTY output, cron, CI, `NO_COLOR`, or `--plain`. Uses stable text with no animation, decorative boxes, or color dependency.
- `json`: selected through `--json` for commands that expose structured results. Emits machine-readable success and failure payloads.

Global flags:

- `--plain`: force plain output.
- `--json`: request JSON output where supported.
- `--no-color`: disable ANSI color while preserving rich layout when stdout is otherwise eligible for rich mode.
- `--quiet`: suppress nonessential output for commands that support script usage.

If `--json` is requested for a command that cannot produce meaningful JSON yet, the command should exit nonzero and write only a JSON error object to stdout. It must not mix JSON with human text.

## Command Shape

Existing commands remain available:

- `token-burn setup`
- `token-burn login`
- `token-burn logout`
- `token-burn status`
- `token-burn sync`
- `token-burn doctor`
- `token-burn devices`
- `token-burn devices merge <source-device-id> <target-device-id>`
- `token-burn install-scheduler`
- `token-burn uninstall-scheduler`

Add grouped commands for a cleaner modern surface:

- `token-burn devices list`
- `token-burn scheduler install`
- `token-burn scheduler uninstall`

The existing scheduler commands should act as aliases during the transition. They should not warn initially, because setup docs and user scripts may still reference them.

## Architecture

Add a `ui` module with small, composable files:

- `mode.ts`: resolves `rich`, `plain`, or `json` from TTY state, flags, and environment.
- `theme.ts`: defines Clean Operator color roles, symbols, spacing, and label conventions.
- `types.ts`: defines renderer interfaces and structured presentation events.
- `rich-renderer.ts`: renders human-first output with Clack-style components, color, spinners, compact panels, and tables.
- `plain-renderer.ts`: renders log-safe text output.
- `json-renderer.ts`: renders structured command results and errors.
- `renderer.ts`: creates the renderer selected by mode.

Commands should receive a small output interface rather than calling `console.log` directly. The current injected `log(message)` test seam can evolve into typed renderer calls.

For short commands, services may return a structured result and let the command action render once. For longer flows, such as `setup` and `login`, commands may emit typed progress events:

```ts
ui.step("auth", "Checking authentication");
ui.success("auth", "Authenticated as nayan");
ui.step("sync", "Submitting usage totals");
ui.warning("sync", "Codex skipped: no usage found");
```

The same event stream should render differently by mode.

## Command Experiences

### `setup`

Rich mode shows:

- An intro panel with server URL and setup purpose.
- Steps for authentication, first sync, and scheduler installation.
- A final summary with automatic sync cadence and next useful command.

Plain mode shows stable step lines. JSON mode can return final setup state, including whether auth was reused, whether sync succeeded, and whether scheduler install succeeded.

### `login`

Rich mode shows browser-opening status, approval wait state, expiration handling, and authenticated identity. Plain mode keeps the login URL easy to copy when automatic browser opening fails.

### `sync`

Rich mode shows a concise submitted/skipped/failed summary, with provider breakdown when relevant. Plain mode remains suitable for scheduler logs. JSON mode should include submitted count, skipped providers, failed providers, synced timestamp, and last-sync status.

### `status`

Rich mode shows a compact health card with CLI version, authentication state, server, device, last sync, and required-version warning. JSON mode should expose the same facts for scripts.

### `doctor`

Rich mode shows diagnostic sections for local config, platform, server health, last sync, and duplicate-device warnings. Known issues should include next actions.

### `devices`

Rich mode shows a table of devices and grouped duplicate suggestions. The `devices list` alias should map to the same behavior as `devices`. Merge output should summarize deleted duplicate rows, moved rows, resolved conflicts, and whether the source device was deleted.

### Scheduler Commands

Grouped commands should become the preferred surface:

- `token-burn scheduler install`
- `token-burn scheduler uninstall`

Dry-run output should remain readable in plain mode because it may contain generated platform scheduler config.

## Error Handling

Top-level command execution should catch errors and route them through the selected renderer.

Rich errors should include:

- A compact error block.
- Known cause or category when available.
- A next action when one is known.

Plain errors should preserve simple text suitable for logs.

JSON errors should use a stable shape:

```json
{
  "ok": false,
  "error": {
    "message": "Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate.",
    "code": "AUTH_REQUIRED"
  }
}
```

Known error categories should include:

- Authentication required.
- Required CLI version mismatch.
- Missing or unsupported provider usage.
- `ccusage` native binary permission issue.
- Scheduler install or uninstall failure.
- Server health failure.
- Device merge failure.

## Testing Strategy

- Keep service behavior tests focused on command order, network calls, config writes, and returned structured results.
- Unit-test renderers separately with deterministic width and color disabled.
- Update existing output assertions to check structured events or renderer calls rather than ad hoc final strings.
- Add mode-selection tests for TTY, non-TTY, `NO_COLOR`, `--plain`, `--json`, and `--no-color`.
- Add representative render tests for setup, sync, status, doctor, devices, scheduler install, and error output.
- Preserve scheduler and sync automation tests to ensure non-TTY/plain output stays cron-friendly.

## Migration Plan

1. Add mode resolution and renderer interfaces.
2. Add the Clean Operator theme and rich/plain/json renderer skeletons.
3. Convert one low-risk command, such as `status`, to validate the pattern.
4. Convert `sync` with extra care for scheduler and non-TTY output.
5. Convert setup/login/scheduler/devices/doctor.
6. Add grouped scheduler and devices aliases.
7. Update CLI README and setup page references to prefer grouped scheduler commands for human-run workflows while preserving existing no-install `setup` guidance.

## Open Decisions Resolved

- Architecture: Clack-style rich CLI with a shared renderer.
- Visual personality: Clean Operator.
- Scope: every command uses the visual system.
- Command redesign: additive command grouping is allowed, while existing commands remain available.
