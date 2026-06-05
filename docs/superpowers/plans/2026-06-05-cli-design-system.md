# CLI Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standardized Clean Operator CLI presentation system for every Token Burn command with rich, plain, and JSON output modes.

**Architecture:** Keep Commander as the parser and add a shared `packages/cli/src/ui/` presentation layer. Commands should return structured results or emit typed UI events, then render through rich/plain/json renderers selected by startup mode and global flags.

**Tech Stack:** TypeScript, Commander, Vitest, `@clack/prompts`, `picocolors`, `cli-table3`, `wrap-ansi`, Node.js 24.

---

## File Structure

- Create `packages/cli/src/ui/mode.ts`: resolves `rich`, `plain`, or `json` from TTY, env, and flags.
- Create `packages/cli/src/ui/theme.ts`: defines Clean Operator labels, symbols, and color roles.
- Create `packages/cli/src/ui/types.ts`: defines shared renderer interfaces, structured events, errors, and command result types.
- Create `packages/cli/src/ui/plain-renderer.ts`: writes log-safe text.
- Create `packages/cli/src/ui/json-renderer.ts`: writes stable JSON success and error objects.
- Create `packages/cli/src/ui/rich-renderer.ts`: writes Clean Operator rich output with color, compact panels, symbols, tables, and Clack-style spinners.
- Create `packages/cli/src/ui/renderer.ts`: selects renderer by output mode.
- Create tests beside UI files: `mode.test.ts`, `plain-renderer.test.ts`, `json-renderer.test.ts`, `rich-renderer.test.ts`, `renderer.test.ts`.
- Modify `packages/cli/src/index.ts`: add global output flags, selected renderer creation, top-level rendered error handling, and grouped scheduler command registration.
- Modify all files in `packages/cli/src/commands/`: replace direct `log(message)` output with renderer calls or structured return values.
- Modify `packages/cli/src/sync.ts`: return a structured `SyncResult` while preserving plain scheduler-safe output.
- Modify `packages/cli/package.json`: add CLI presentation dependencies.
- Modify `packages/cli/README.md`, `README.md`, and `apps/web/src/app/setup/page.tsx`: update command docs to prefer grouped scheduler commands while preserving no-install setup guidance.

---

### Task 1: Add Output Mode Resolution

**Files:**
- Modify: `packages/cli/package.json`
- Create: `packages/cli/src/ui/mode.ts`
- Test: `packages/cli/src/ui/mode.test.ts`

- [ ] **Step 1: Add CLI presentation dependencies**

Run:

```bash
pnpm --filter @blnayan/token-burn add @clack/prompts picocolors cli-table3 wrap-ansi
```

Expected: `packages/cli/package.json` gains the four dependencies and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Write failing mode tests**

Create `packages/cli/src/ui/mode.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { resolveOutputMode } from "./mode.js";

describe("resolveOutputMode", () => {
  it("uses rich mode for an interactive terminal", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: {} })).toEqual({
      color: true,
      mode: "rich",
      quiet: false,
    });
  });

  it("uses plain mode for non-TTY output", () => {
    expect(resolveOutputMode({ stdoutIsTTY: false, env: {}, flags: {} })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("uses plain mode when NO_COLOR is set", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: { NO_COLOR: "1" }, flags: {} })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("honors --plain over interactive TTY", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: { plain: true } })).toEqual({
      color: false,
      mode: "plain",
      quiet: false,
    });
  });

  it("honors --json over --plain and TTY detection", () => {
    expect(resolveOutputMode({ stdoutIsTTY: false, env: {}, flags: { json: true, plain: true } })).toEqual({
      color: false,
      mode: "json",
      quiet: false,
    });
  });

  it("keeps rich layout without ANSI color for --no-color", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: { color: false } })).toEqual({
      color: false,
      mode: "rich",
      quiet: false,
    });
  });

  it("passes quiet mode through", () => {
    expect(resolveOutputMode({ stdoutIsTTY: true, env: {}, flags: { quiet: true } })).toEqual({
      color: true,
      mode: "rich",
      quiet: true,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/mode.test.ts
```

Expected: FAIL because `packages/cli/src/ui/mode.ts` does not exist.

- [ ] **Step 4: Implement mode resolution**

Create `packages/cli/src/ui/mode.ts`:

```ts
export type OutputMode = "rich" | "plain" | "json";

export type OutputFlags = {
  color?: boolean;
  json?: boolean;
  plain?: boolean;
  quiet?: boolean;
};

export type OutputModeConfig = {
  color: boolean;
  mode: OutputMode;
  quiet: boolean;
};

export function resolveOutputMode({
  stdoutIsTTY = Boolean(process.stdout.isTTY),
  env = process.env,
  flags,
}: {
  stdoutIsTTY?: boolean;
  env?: Pick<NodeJS.ProcessEnv, "CI" | "NO_COLOR">;
  flags: OutputFlags;
}): OutputModeConfig {
  if (flags.json) {
    return { color: false, mode: "json", quiet: flags.quiet === true };
  }

  if (flags.plain || !stdoutIsTTY || env.NO_COLOR || env.CI) {
    return { color: false, mode: "plain", quiet: flags.quiet === true };
  }

  return {
    color: flags.color !== false,
    mode: "rich",
    quiet: flags.quiet === true,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/mode.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/package.json pnpm-lock.yaml packages/cli/src/ui/mode.ts packages/cli/src/ui/mode.test.ts
git commit -m "feat(cli): add output mode resolution"
```

---

### Task 2: Add Renderer Types, Theme, and Plain Renderer

**Files:**
- Create: `packages/cli/src/ui/types.ts`
- Create: `packages/cli/src/ui/theme.ts`
- Create: `packages/cli/src/ui/plain-renderer.ts`
- Test: `packages/cli/src/ui/plain-renderer.test.ts`

- [ ] **Step 1: Write failing plain renderer tests**

Create `packages/cli/src/ui/plain-renderer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createPlainRenderer } from "./plain-renderer.js";

describe("createPlainRenderer", () => {
  it("writes stable step and summary output", () => {
    const write = vi.fn();
    const ui = createPlainRenderer({ write });

    ui.intro("Token Burn setup", [{ label: "Server", value: "https://token-burn.test" }]);
    ui.step("auth", "Checking authentication");
    ui.success("auth", "Authenticated as nayan");
    ui.warning("sync", "Codex skipped: no usage found");
    ui.summary("Setup complete", [{ label: "Automatic sync", value: "Every 15 minutes" }]);
    ui.nextAction("Run token-burn status");

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "Token Burn setup",
      "Server: https://token-burn.test",
      "Checking authentication",
      "OK: Authenticated as nayan",
      "Warning: Codex skipped: no usage found",
      "Setup complete",
      "Automatic sync: Every 15 minutes",
      "Next: Run token-burn status",
    ]);
  });

  it("renders errors as plain text", () => {
    const write = vi.fn();
    const ui = createPlainRenderer({ write });

    ui.error({ code: "AUTH_REQUIRED", message: "Run token-burn login to authenticate.", nextAction: "token-burn login" });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "Error: Run token-burn login to authenticate.",
      "Next: token-burn login",
    ]);
  });

  it("omits nonessential output in quiet mode", () => {
    const write = vi.fn();
    const ui = createPlainRenderer({ quiet: true, write });

    ui.step("sync", "Submitting usage totals");
    ui.success("sync", "Submitted 42 usage rows");
    ui.error({ code: "SYNC_FAILED", message: "All providers failed." });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "OK: Submitted 42 usage rows",
      "Error: All providers failed.",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/plain-renderer.test.ts
```

Expected: FAIL because renderer files do not exist.

- [ ] **Step 3: Implement types, theme, and plain renderer**

Create `packages/cli/src/ui/types.ts`:

```ts
export type UiDetail = {
  label: string;
  value: string;
};

export type UiTable = {
  columns: string[];
  rows: string[][];
};

export type UiError = {
  code: string;
  message: string;
  nextAction?: string;
};

export type UiRenderer = {
  intro(title: string, details?: UiDetail[]): void;
  step(id: string, message: string): void;
  success(id: string, message: string): void;
  warning(id: string, message: string): void;
  info(message: string): void;
  table(title: string, table: UiTable): void;
  summary(title: string, details?: UiDetail[]): void;
  nextAction(message: string): void;
  error(error: UiError): void;
  result<T extends Record<string, unknown>>(result: T): void;
};
```

Create `packages/cli/src/ui/theme.ts`:

```ts
export const cleanOperatorTheme = {
  labels: {
    error: "Error",
    next: "Next",
    ok: "OK",
    warning: "Warning",
  },
  symbols: {
    error: "x",
    info: "-",
    ok: "✓",
    step: "•",
    warning: "!",
  },
} as const;
```

Create `packages/cli/src/ui/plain-renderer.ts`:

```ts
import type { UiDetail, UiError, UiRenderer, UiTable } from "./types.js";

type PlainRendererOptions = {
  quiet?: boolean;
  write?: (line: string) => void;
};

export function createPlainRenderer({
  quiet = false,
  write = console.log,
}: PlainRendererOptions = {}): UiRenderer {
  const writeDetails = (details: UiDetail[] = []) => {
    for (const detail of details) {
      write(`${detail.label}: ${detail.value}`);
    }
  };

  return {
    intro(title, details = []) {
      if (quiet) return;
      write(title);
      writeDetails(details);
    },
    step(_id, message) {
      if (quiet) return;
      write(message);
    },
    success(_id, message) {
      write(`OK: ${message}`);
    },
    warning(_id, message) {
      write(`Warning: ${message}`);
    },
    info(message) {
      if (quiet) return;
      write(message);
    },
    table(title, table) {
      if (quiet) return;
      write(title);
      write(formatPlainTable(table));
    },
    summary(title, details = []) {
      if (quiet) return;
      write(title);
      writeDetails(details);
    },
    nextAction(message) {
      if (quiet) return;
      write(`Next: ${message}`);
    },
    error(error) {
      write(`Error: ${error.message}`);
      if (error.nextAction) {
        write(`Next: ${error.nextAction}`);
      }
    },
    result(result) {
      if (quiet) return;
      write(JSON.stringify(result));
    },
  };
}

function formatPlainTable({ columns, rows }: UiTable): string {
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();

  return [formatRow(columns), ...rows.map(formatRow)].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/plain-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/ui/types.ts packages/cli/src/ui/theme.ts packages/cli/src/ui/plain-renderer.ts packages/cli/src/ui/plain-renderer.test.ts
git commit -m "feat(cli): add plain UI renderer"
```

---

### Task 3: Add JSON and Rich Renderers

**Files:**
- Create: `packages/cli/src/ui/json-renderer.ts`
- Create: `packages/cli/src/ui/rich-renderer.ts`
- Create: `packages/cli/src/ui/renderer.ts`
- Test: `packages/cli/src/ui/json-renderer.test.ts`
- Test: `packages/cli/src/ui/rich-renderer.test.ts`
- Test: `packages/cli/src/ui/renderer.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Create `packages/cli/src/ui/json-renderer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createJsonRenderer } from "./json-renderer.js";

describe("createJsonRenderer", () => {
  it("writes only final result JSON", () => {
    const write = vi.fn();
    const ui = createJsonRenderer({ write });

    ui.step("sync", "Submitting usage totals");
    ui.result({ ok: true, submitted: 42 });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      JSON.stringify({ ok: true, submitted: 42 }),
    ]);
  });

  it("writes JSON errors", () => {
    const write = vi.fn();
    const ui = createJsonRenderer({ write });

    ui.error({ code: "AUTH_REQUIRED", message: "Run token-burn login to authenticate." });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      JSON.stringify({ ok: false, error: { code: "AUTH_REQUIRED", message: "Run token-burn login to authenticate." } }),
    ]);
  });
});
```

Create `packages/cli/src/ui/rich-renderer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createRichRenderer } from "./rich-renderer.js";

describe("createRichRenderer", () => {
  it("writes Clean Operator output without color when color is false", () => {
    const write = vi.fn();
    const ui = createRichRenderer({ color: false, write });

    ui.intro("Token Burn", [{ label: "Mode", value: "setup" }]);
    ui.success("auth", "Authenticated as nayan");
    ui.table("Devices", {
      columns: ["ID", "Name"],
      rows: [["device-1", "nayan-vps"]],
    });
    ui.error({ code: "AUTH_REQUIRED", message: "Run token-burn login.", nextAction: "token-burn login" });

    expect(write.mock.calls.map(([line]) => line)).toEqual([
      "Token Burn",
      "  Mode  setup",
      "✓ Authenticated as nayan",
      "Devices",
      "ID        Name",
      "device-1  nayan-vps",
      "x Run token-burn login.",
      "  Next  token-burn login",
    ]);
  });
});
```

Create `packages/cli/src/ui/renderer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import { createRenderer } from "./renderer.js";

describe("createRenderer", () => {
  it("creates a plain renderer", () => {
    const write = vi.fn();
    const ui = createRenderer({ color: false, mode: "plain", quiet: false }, { write });

    ui.success("sync", "Submitted 1 usage row");

    expect(write.mock.calls.map(([line]) => line)).toEqual(["OK: Submitted 1 usage row"]);
  });

  it("creates a json renderer", () => {
    const write = vi.fn();
    const ui = createRenderer({ color: false, mode: "json", quiet: false }, { write });

    ui.result({ ok: true });

    expect(write.mock.calls.map(([line]) => line)).toEqual([JSON.stringify({ ok: true })]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/json-renderer.test.ts src/ui/rich-renderer.test.ts src/ui/renderer.test.ts
```

Expected: FAIL because renderers do not exist.

- [ ] **Step 3: Implement JSON renderer**

Create `packages/cli/src/ui/json-renderer.ts`:

```ts
import type { UiError, UiRenderer } from "./types.js";

type JsonRendererOptions = {
  write?: (line: string) => void;
};

export function createJsonRenderer({ write = console.log }: JsonRendererOptions = {}): UiRenderer {
  return {
    intro() {},
    step() {},
    success() {},
    warning() {},
    info() {},
    table() {},
    summary() {},
    nextAction() {},
    error(error: UiError) {
      write(JSON.stringify({ ok: false, error: serializeError(error) }));
    },
    result(result) {
      write(JSON.stringify(result));
    },
  };
}

function serializeError(error: UiError): { code: string; message: string; nextAction?: string } {
  return {
    code: error.code,
    message: error.message,
    ...(error.nextAction ? { nextAction: error.nextAction } : {}),
  };
}
```

- [ ] **Step 4: Implement rich renderer and renderer factory**

Create `packages/cli/src/ui/rich-renderer.ts`:

```ts
import pc from "picocolors";

import { cleanOperatorTheme } from "./theme.js";
import type { UiDetail, UiError, UiRenderer, UiTable } from "./types.js";

type RichRendererOptions = {
  color?: boolean;
  quiet?: boolean;
  write?: (line: string) => void;
};

export function createRichRenderer({
  color = true,
  quiet = false,
  write = console.log,
}: RichRendererOptions = {}): UiRenderer {
  const paint = color ? pc : createNoColor();
  const detail = (item: UiDetail) => `  ${paint.dim(item.label.padEnd(5))}  ${item.value}`;

  return {
    intro(title, details = []) {
      if (quiet) return;
      write(paint.bold(title));
      for (const item of details) write(detail(item));
    },
    step(_id, message) {
      if (quiet) return;
      write(`${paint.dim(cleanOperatorTheme.symbols.step)} ${message}`);
    },
    success(_id, message) {
      write(`${paint.green(cleanOperatorTheme.symbols.ok)} ${message}`);
    },
    warning(_id, message) {
      write(`${paint.yellow(cleanOperatorTheme.symbols.warning)} ${message}`);
    },
    info(message) {
      if (quiet) return;
      write(`${paint.dim(cleanOperatorTheme.symbols.info)} ${message}`);
    },
    table(title, table) {
      if (quiet) return;
      write(paint.bold(title));
      write(formatRichTable(table));
    },
    summary(title, details = []) {
      if (quiet) return;
      write(paint.bold(title));
      for (const item of details) write(detail(item));
    },
    nextAction(message) {
      if (quiet) return;
      write(`  ${paint.dim("Next".padEnd(5))}  ${message}`);
    },
    error(error: UiError) {
      write(`${paint.red(cleanOperatorTheme.symbols.error)} ${error.message}`);
      if (error.nextAction) write(`  ${paint.dim("Next".padEnd(5))}  ${error.nextAction}`);
    },
    result(result) {
      if (quiet) return;
      write(JSON.stringify(result));
    },
  };
}

function formatRichTable({ columns, rows }: UiTable): string {
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();

  return [formatRow(columns), ...rows.map(formatRow)].join("\n");
}

function createNoColor(): typeof pc {
  const identity = (value: string) => value;

  return new Proxy(pc, {
    get() {
      return identity;
    },
  });
}
```

Create `packages/cli/src/ui/renderer.ts`:

```ts
import type { OutputModeConfig } from "./mode.js";
import { createJsonRenderer } from "./json-renderer.js";
import { createPlainRenderer } from "./plain-renderer.js";
import { createRichRenderer } from "./rich-renderer.js";
import type { UiRenderer } from "./types.js";

type RendererFactoryOptions = {
  write?: (line: string) => void;
};

export function createRenderer(
  config: OutputModeConfig,
  { write = console.log }: RendererFactoryOptions = {},
): UiRenderer {
  if (config.mode === "json") return createJsonRenderer({ write });
  if (config.mode === "plain") return createPlainRenderer({ quiet: config.quiet, write });

  return createRichRenderer({ color: config.color, quiet: config.quiet, write });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/json-renderer.test.ts src/ui/rich-renderer.test.ts src/ui/renderer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/ui/json-renderer.ts packages/cli/src/ui/json-renderer.test.ts packages/cli/src/ui/rich-renderer.ts packages/cli/src/ui/rich-renderer.test.ts packages/cli/src/ui/renderer.ts packages/cli/src/ui/renderer.test.ts
git commit -m "feat(cli): add rich and json UI renderers"
```

---

### Task 4: Wire Global Flags and Rendered Top-Level Errors

**Files:**
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/index.test.ts`

- [ ] **Step 1: Write failing top-level tests**

Create `packages/cli/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createProgram } from "./index.js";

describe("createProgram", () => {
  it("exposes global output flags in help", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("--plain");
    expect(help).toContain("--json");
    expect(help).toContain("--no-color");
    expect(help).toContain("--quiet");
  });

  it("registers grouped scheduler commands", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("scheduler");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/index.test.ts
```

Expected: FAIL because `createProgram` is not exported and global flags do not exist.

- [ ] **Step 3: Refactor `index.ts`**

Replace `packages/cli/src/index.ts` with:

```ts
#!/usr/bin/env node
import { Command } from "commander";

import { createDevicesCommand } from "./commands/devices.js";
import { createDoctorCommand } from "./commands/doctor.js";
import { createLoginCommand } from "./commands/login.js";
import { createLogoutCommand } from "./commands/logout.js";
import { createInstallSchedulerCommand, createSchedulerCommand, createUninstallSchedulerCommand } from "./commands/scheduler.js";
import { createSetupCommand } from "./commands/setup.js";
import { createSyncCommand } from "./commands/sync.js";
import { createStatusCommand } from "./commands/status.js";
import { resolveOutputMode, type OutputFlags } from "./ui/mode.js";
import { createRenderer } from "./ui/renderer.js";
import { cliVersion } from "./version.js";

export function createProgram(): Command {
  const program = new Command()
    .name("token-burn")
    .description("Token Burn command line tools")
    .version(cliVersion)
    .option("--plain", "Force plain, log-safe output")
    .option("--json", "Emit machine-readable JSON where supported")
    .option("--no-color", "Disable ANSI color")
    .option("--quiet", "Suppress nonessential output");

  program.addCommand(createSetupCommand());
  program.addCommand(createLoginCommand());
  program.addCommand(createLogoutCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createSyncCommand());
  program.addCommand(createDevicesCommand());
  program.addCommand(createDoctorCommand());
  program.addCommand(createSchedulerCommand());
  program.addCommand(createInstallSchedulerCommand());
  program.addCommand(createUninstallSchedulerCommand());

  return program;
}

const program = createProgram();

program.parseAsync().catch((error: unknown) => {
  const flags = program.opts<OutputFlags>();
  const outputMode = resolveOutputMode({ flags });
  const ui = createRenderer(outputMode, { write: console.error });
  const message = error instanceof Error ? error.message : String(error);

  ui.error({ code: "CLI_ERROR", message });
  process.exitCode = 1;
});
```

- [ ] **Step 4: Run test to verify the expected remaining failure**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/index.test.ts
```

Expected: FAIL because `createSchedulerCommand` is not exported from `packages/cli/src/commands/scheduler.ts`.

- [ ] **Step 5: Add grouped scheduler command**

In `packages/cli/src/commands/scheduler.ts`, add this exported function below `createUninstallSchedulerCommand`:

```ts
export function createSchedulerCommand(): Command {
  const command = new Command("scheduler").description("Manage automatic Token Burn sync");

  command
    .command("install")
    .description("Install automatic Token Burn sync")
    .option("--dry-run", "Print the generated platform scheduler config or command")
    .action(async (options: { dryRun?: boolean }) => {
      await runInstallScheduler({ dryRun: options.dryRun === true });
    });

  command.command("uninstall").description("Remove automatic Token Burn sync").action(async () => {
    await runUninstallScheduler();
  });

  return command;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/src/commands/scheduler.ts
git commit -m "feat(cli): add global output flags"
```

---

### Task 5: Convert Status and Doctor to Structured Results

**Files:**
- Modify: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/commands/status.test.ts`
- Modify: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/commands/doctor.test.ts`

- [ ] **Step 1: Write failing status result test**

In `packages/cli/src/commands/status.test.ts`, add:

```ts
it("returns structured status for renderers", async () => {
  const result = await runStatus({
    readConfig: async () => ({
      serverUrl: "https://token-burn.test",
      token: "tb_secret",
      deviceId: "device-1",
      deviceName: "nayan-vps",
      lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
    }),
    readHealth: async () => ({
      requiredCliVersion: cliVersion,
      serverTime: "2026-06-03T00:00:00.000Z",
    }),
    log: () => undefined,
  });

  expect(result).toEqual({
    authenticated: true,
    cliVersion,
    device: { id: "device-1", name: "nayan-vps" },
    lastSync: { ok: true, message: "Submitted 42 usage rows.", at: "2026-06-01T00:00:00.000Z" },
    rememberedServer: undefined,
    requiredCliVersion: cliVersion,
    serverHealthError: undefined,
    serverUrl: "https://token-burn.test",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/status.test.ts
```

Expected: FAIL because `runStatus` returns `void`.

- [ ] **Step 3: Add status result type and return value**

In `packages/cli/src/commands/status.ts`, add:

```ts
export type StatusResult = {
  authenticated: boolean;
  cliVersion: string;
  device?: { id: string; name: string };
  lastSync?: CliConfig["lastSync"];
  rememberedServer?: string;
  requiredCliVersion?: string;
  serverHealthError?: string;
  serverUrl?: string;
};
```

Change `runStatus` signature to:

```ts
export async function runStatus({
  readConfig = readConfigFile,
  readHealth = readHealthFromServer,
  log = console.log,
}: StatusDependencies = {}): Promise<StatusResult> {
```

At the start, keep the existing `log` calls for compatibility during this task and build a `result`. Return these exact objects in each branch:

```ts
if (!config) {
  log("Not authenticated.");
  return { authenticated: false, cliVersion };
}
```

For config with no token:

```ts
return {
  authenticated: false,
  cliVersion,
  rememberedServer: config.serverUrl,
  serverUrl: config.serverUrl,
};
```

For authenticated config after health check:

```ts
return {
  authenticated: true,
  cliVersion,
  ...(config.deviceId && config.deviceName ? { device: { id: config.deviceId, name: config.deviceName } } : {}),
  ...(config.lastSync ? { lastSync: config.lastSync } : {}),
  ...(requiredCliVersion ? { requiredCliVersion } : {}),
  ...(serverHealthError ? { serverHealthError } : {}),
  serverUrl: config.serverUrl,
};
```

Use local variables:

```ts
let requiredCliVersion: string | undefined;
let serverHealthError: string | undefined;
```

- [ ] **Step 4: Run status tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Repeat the same pattern for doctor**

In `packages/cli/src/commands/doctor.ts`, add:

```ts
export type DoctorResult = {
  authenticated: boolean;
  cliVersion: string;
  device?: { id: string; name: string };
  duplicateDeviceGroups: DuplicateDeviceGroup[];
  deviceCheckError?: string;
  lastSync?: CliConfig["lastSync"];
  platform: SchedulerPlatform;
  rememberedServer?: string;
  serverHealthError?: string;
  serverUrl?: string;
};
```

Add this test to `doctor.test.ts`:

```ts
it("returns structured diagnostics for renderers", async () => {
  const result = await runDoctor({
    readConfig: async () => ({
      serverUrl: "https://token-burn.test",
      token: "tb_secret",
      deviceId: "device-1",
      deviceName: "nayan-vps",
    }),
    platform: "linux",
    readHealth: async () => ({ requiredCliVersion: cliVersion, serverTime: "2026-06-03T00:00:00.000Z" }),
    readDevices: async () => ({
      duplicateGroups: [{ name: "nayan-vps", os: "linux", duplicateRows: 2, conflictRows: 0 }],
    }),
    log: () => undefined,
  });

  expect(result).toEqual({
    authenticated: true,
    cliVersion,
    device: { id: "device-1", name: "nayan-vps" },
    duplicateDeviceGroups: [{ name: "nayan-vps", os: "linux", duplicateRows: 2, conflictRows: 0 }],
    platform: "linux",
    serverUrl: "https://token-burn.test",
  });
});
```

Change `runDoctor` to return `Promise<DoctorResult>` while preserving existing logs during this task.

- [ ] **Step 6: Run doctor tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/doctor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/status.ts packages/cli/src/commands/status.test.ts packages/cli/src/commands/doctor.ts packages/cli/src/commands/doctor.test.ts
git commit -m "refactor(cli): return status and doctor results"
```

---

### Task 6: Render Status and Doctor Through the UI Layer

**Files:**
- Modify: `packages/cli/src/commands/status.ts`
- Modify: `packages/cli/src/commands/status.test.ts`
- Modify: `packages/cli/src/commands/doctor.ts`
- Modify: `packages/cli/src/commands/doctor.test.ts`
- Modify: `packages/cli/src/ui/types.ts`

- [ ] **Step 1: Add render tests**

In `packages/cli/src/commands/status.test.ts`, add:

```ts
it("renders status with the provided renderer", async () => {
  const calls: string[] = [];

  await runStatus({
    readConfig: async () => ({ serverUrl: "https://token-burn.test", token: "tb_secret" }),
    readHealth: async () => ({ requiredCliVersion: cliVersion, serverTime: "2026-06-03T00:00:00.000Z" }),
    ui: {
      intro: (title, details = []) => calls.push(`intro:${title}:${details.length}`),
      step: () => undefined,
      success: (_id, message) => calls.push(`success:${message}`),
      warning: () => undefined,
      info: (message) => calls.push(`info:${message}`),
      table: () => undefined,
      summary: () => undefined,
      nextAction: () => undefined,
      error: () => undefined,
      result: (result) => calls.push(`result:${JSON.stringify(result)}`),
    },
    log: () => undefined,
  });

  expect(calls).toContain("intro:Token Burn status:2");
  expect(calls).toContain("success:Authenticated with https://token-burn.test");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/status.test.ts
```

Expected: FAIL because `StatusDependencies` does not accept `ui`.

- [ ] **Step 3: Add renderer dependency and status rendering**

In `packages/cli/src/commands/status.ts`, import:

```ts
import type { UiRenderer } from "../ui/types.js";
import { createRenderer } from "../ui/renderer.js";
import { resolveOutputMode } from "../ui/mode.js";
```

Add `ui?: UiRenderer` to `StatusDependencies`.

Use this default:

```ts
const defaultUi = createRenderer(resolveOutputMode({ flags: {} }));
```

After building the result, call:

```ts
renderStatus(result, ui);
```

Add:

```ts
export function renderStatus(result: StatusResult, ui: UiRenderer): void {
  ui.intro("Token Burn status", [
    { label: "CLI", value: result.cliVersion },
    { label: "Auth", value: result.authenticated ? "authenticated" : "not authenticated" },
  ]);

  if (result.serverUrl) ui.info(`Server: ${result.serverUrl}`);
  if (result.rememberedServer) ui.info(`Remembered server: ${result.rememberedServer}`);
  if (result.device) ui.info(`Device: ${result.device.name} (${result.device.id})`);
  if (result.lastSync) {
    ui.info(`Last sync: ${result.lastSync.ok ? "OK" : "Failed"} - ${result.lastSync.message} at ${result.lastSync.at}`);
  }
  if (result.serverHealthError) ui.warning("health", `Server health check failed: ${result.serverHealthError}`);
  if (result.requiredCliVersion && result.requiredCliVersion !== result.cliVersion) {
    ui.warning("version", formatRequiredCliVersionError(result.cliVersion, result.requiredCliVersion));
  }
  if (result.authenticated && result.serverUrl) ui.success("auth", `Authenticated with ${result.serverUrl}`);
  if (!result.authenticated) ui.warning("auth", "Not authenticated");
  ui.result({ ok: true, ...result });
}
```

Remove old direct `log(...)` calls from `runStatus` after the test coverage is updated to assert renderer behavior.

- [ ] **Step 4: Update existing status tests**

Replace string-based `log` assertions in `status.test.ts` with assertions against `renderStatus` result fields and renderer calls. Keep the existing health failure and remembered server cases, but assert `serverHealthError` and `rememberedServer` in the returned result.

- [ ] **Step 5: Apply the same renderer pattern to doctor**

Add `ui?: UiRenderer` to `DoctorDependencies`, add `renderDoctor(result, ui)`, and render:

```ts
ui.intro("Token Burn doctor", [
  { label: "CLI", value: result.cliVersion },
  { label: "Platform", value: result.platform },
]);
```

Use `ui.warning("devices", "Likely duplicate devices found. Run token-burn devices to inspect and merge.")` when `duplicateDeviceGroups.length > 0`.

Use `ui.nextAction("Run token-burn sync to submit usage now.")` at the end.

Remove old direct `log(...)` calls from `runDoctor` after tests assert renderer behavior.

- [ ] **Step 6: Run command tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/status.test.ts src/commands/doctor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/status.ts packages/cli/src/commands/status.test.ts packages/cli/src/commands/doctor.ts packages/cli/src/commands/doctor.test.ts packages/cli/src/ui/types.ts
git commit -m "feat(cli): render status and doctor with shared UI"
```

---

### Task 7: Convert Sync to Structured Results and Plain-Safe Rendering

**Files:**
- Modify: `packages/cli/src/sync.ts`
- Modify: `packages/cli/src/sync.test.ts`
- Modify: `packages/cli/src/commands/sync.ts`
- Modify: `packages/cli/src/commands/sync.test.ts`

- [ ] **Step 1: Add failing sync result test**

In `packages/cli/src/sync.test.ts`, add a test that expects `syncUsage` to return:

```ts
expect(result).toEqual({
  failedProviders: [],
  lastSync: {
    ok: true,
    message: "Submitted 1 usage row.",
    at: "2026-06-01T00:00:00.000Z",
  },
  skippedProviders: [],
  submitted: 1,
  syncedAt: "2026-06-01T00:00:00.000Z",
});
```

Use the existing successful sync fixture setup in the file so the only new expectation is the returned result.

- [ ] **Step 2: Run sync test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts
```

Expected: FAIL because `syncUsage` returns `void`.

- [ ] **Step 3: Add `SyncResult` and return it**

In `packages/cli/src/sync.ts`, add:

```ts
export type SyncProviderIssue = {
  provider: Provider;
  message: string;
};

export type SyncResult = {
  failedProviders: SyncProviderIssue[];
  lastSync: NonNullable<CliConfig["lastSync"]>;
  skippedProviders: SyncProviderIssue[];
  submitted: number;
  syncedAt: string;
};
```

Change `syncUsage` to `Promise<SyncResult>`.

After `log(message);`, return:

```ts
return {
  failedProviders: failures.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
  lastSync,
  skippedProviders: skipped.map(({ provider, error }) => ({ provider, message: trimTrailingPeriod(error.message) })),
  submitted,
  syncedAt,
};
```

- [ ] **Step 4: Run sync tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts
```

Expected: PASS.

- [ ] **Step 5: Render `sync` command through the UI layer**

In `packages/cli/src/commands/sync.ts`, replace the action with:

```ts
import { Command } from "commander";

import { syncUsage, type SyncResult } from "../sync.js";
import { resolveOutputMode } from "../ui/mode.js";
import { createRenderer } from "../ui/renderer.js";
import type { UiRenderer } from "../ui/types.js";

export function renderSyncResult(result: SyncResult, ui: UiRenderer): void {
  if (result.failedProviders.length === 0) {
    ui.success("sync", result.lastSync.message);
  } else {
    ui.warning("sync", result.lastSync.message);
  }

  if (result.skippedProviders.length > 0) {
    ui.table("Skipped providers", {
      columns: ["Provider", "Reason"],
      rows: result.skippedProviders.map((issue) => [issue.provider, issue.message]),
    });
  }

  if (result.failedProviders.length > 0) {
    ui.table("Failed providers", {
      columns: ["Provider", "Reason"],
      rows: result.failedProviders.map((issue) => [issue.provider, issue.message]),
    });
  }

  ui.result({ ok: result.failedProviders.length === 0, ...result });
}

export function createSyncCommand(): Command {
  return new Command("sync").description("Sync ccusage totals to Token Burn").action(async () => {
    const ui = createRenderer(resolveOutputMode({ flags: {} }));
    const result = await syncUsage({ log: () => undefined });
    renderSyncResult(result, ui);
  });
}
```

- [ ] **Step 6: Add command render test**

Create `packages/cli/src/commands/sync.test.ts` if it does not already exist, or append:

```ts
import { describe, expect, it, vi } from "vitest";

import type { SyncResult } from "../sync.js";
import { renderSyncResult } from "./sync.js";

describe("renderSyncResult", () => {
  it("renders provider tables when skips and failures exist", () => {
    const calls: string[] = [];
    const result: SyncResult = {
      failedProviders: [{ provider: "codex", message: "fixture missing" }],
      lastSync: { ok: false, message: "Submitted 1 usage row. Failed providers: codex: fixture missing.", at: "2026-06-01T00:00:00.000Z" },
      skippedProviders: [{ provider: "claude_code", message: "No valid Claude data directories found" }],
      submitted: 1,
      syncedAt: "2026-06-01T00:00:00.000Z",
    };

    renderSyncResult(result, {
      intro: () => undefined,
      step: () => undefined,
      success: () => undefined,
      warning: (_id, message) => calls.push(`warning:${message}`),
      info: () => undefined,
      table: (title) => calls.push(`table:${title}`),
      summary: () => undefined,
      nextAction: () => undefined,
      error: () => undefined,
      result: vi.fn(),
    });

    expect(calls).toEqual([
      "warning:Submitted 1 usage row. Failed providers: codex: fixture missing.",
      "table:Skipped providers",
      "table:Failed providers",
    ]);
  });
});
```

- [ ] **Step 7: Run sync command tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/sync.test.ts src/commands/sync.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/sync.ts packages/cli/src/sync.test.ts packages/cli/src/commands/sync.ts packages/cli/src/commands/sync.test.ts
git commit -m "feat(cli): render sync results with shared UI"
```

---

### Task 8: Convert Login, Setup, Logout, Devices, and Scheduler Commands

**Files:**
- Modify: `packages/cli/src/commands/login.ts`
- Modify: `packages/cli/src/commands/login.test.ts`
- Modify: `packages/cli/src/commands/setup.ts`
- Modify: `packages/cli/src/commands/setup.test.ts`
- Modify: `packages/cli/src/commands/logout.ts`
- Modify: `packages/cli/src/commands/logout.test.ts`
- Modify: `packages/cli/src/commands/devices.ts`
- Modify: `packages/cli/src/commands/devices.test.ts`
- Modify: `packages/cli/src/commands/scheduler.ts`
- Modify: `packages/cli/src/commands/doctor.ts`

- [ ] **Step 1: Add renderer dependency to command dependency types**

For each command dependency type, add:

```ts
ui?: UiRenderer;
```

Import:

```ts
import type { UiRenderer } from "../ui/types.js";
```

Use the renderer in command runners and keep `log?: (message: string) => void` only for compatibility with existing tests during the first conversion pass.

- [ ] **Step 2: Convert login event output**

In `runLogin`, replace direct output with:

```ts
ui.step("login", "Opening approval link in your browser");
ui.info("Waiting for approval. Press Ctrl+C to cancel.");
```

When browser opening fails, render:

```ts
ui.warning("browser", "Could not open your browser automatically");
ui.nextAction(`Open this link in your browser: ${startResponse.loginUrl}`);
```

On approval:

```ts
ui.success("login", `Authenticated as ${pollResponse.member.username ?? pollResponse.member.displayName}`);
```

Return:

```ts
return {
  authenticatedAs: pollResponse.member.username ?? pollResponse.member.displayName,
  serverUrl: normalizedServerUrl,
};
```

Define:

```ts
export type LoginResult = {
  authenticatedAs: string;
  serverUrl: string;
};
```

- [ ] **Step 3: Convert setup event output**

Define:

```ts
export type SetupResult = {
  authReused: boolean;
  schedulerInstalled: boolean;
  syncFailed: boolean;
};
```

Render:

```ts
ui.intro("Token Burn setup", [{ label: "Server", value: normalizedServerUrl }]);
ui.step("auth", "Checking authentication");
ui.success("auth", "Existing authentication is valid");
ui.step("sync", "Submitting usage totals");
ui.success("sync", "First sync complete");
ui.step("scheduler", "Installing automatic sync");
ui.success("scheduler", "Automatic sync will run on quarter-hour boundaries");
ui.summary("Setup complete", [{ label: "Automatic sync", value: "Quarter-hour boundaries" }]);
```

When first sync fails:

```ts
ui.warning("sync", `First sync failed: ${formatErrorMessage(error)}`);
ui.info("Automatic sync was still installed or refreshed and will retry on quarter-hour boundaries.");
```

- [ ] **Step 4: Convert logout output**

Define:

```ts
export type LogoutResult = {
  wasAuthenticated: boolean;
  serverUrl?: string;
};
```

Render:

```ts
if (!config) {
  ui.warning("auth", "Not authenticated");
  return { wasAuthenticated: false };
}

ui.success("logout", "Logged out");
return { serverUrl: config.serverUrl, wasAuthenticated: true };
```

- [ ] **Step 5: Convert devices list and merge output**

Add `export type DeviceListResult = DeviceListResponse;` and `export type DeviceMergeResult = DeviceMergeResponse;`.

Render devices with:

```ts
ui.table("Devices", {
  columns: ["ID", "Name", "OS", "Rows", "Tokens"],
  rows: response.devices.map((device) => [
    device.id,
    device.name,
    device.os,
    String(device.dailyRows),
    device.totalTokens,
  ]),
});
```

Render duplicates with:

```ts
ui.table("Likely duplicates", {
  columns: ["Name", "OS", "Duplicates", "Conflicts"],
  rows: response.duplicateGroups.map((group) => [
    group.name,
    group.os,
    String(group.duplicateRows),
    String(group.conflictRows),
  ]),
});
```

Render merge suggestions using:

```ts
ui.nextAction(`token-burn devices merge ${source.id} ${target.id}`);
```

Add `devices list` as an explicit subcommand:

```ts
command.command("list").description("List Token Burn devices").action(async () => {
  await runListDevices();
});
```

- [ ] **Step 6: Convert scheduler output**

Use `ui.info(output)` for dry-run output and `ui.success("scheduler", output)` for install/uninstall output. Keep dry-run plain-safe by letting the selected renderer choose formatting.

- [ ] **Step 7: Update tests**

For each command test file, replace exact string assertions with either returned result assertions or renderer-call assertions. Preserve at least one test per command that confirms the human message content still appears through the renderer.

- [ ] **Step 8: Run command tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/commands/login.test.ts src/commands/setup.test.ts src/commands/logout.test.ts src/commands/devices.test.ts src/commands/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/commands/login.ts packages/cli/src/commands/login.test.ts packages/cli/src/commands/setup.ts packages/cli/src/commands/setup.test.ts packages/cli/src/commands/logout.ts packages/cli/src/commands/logout.test.ts packages/cli/src/commands/devices.ts packages/cli/src/commands/devices.test.ts packages/cli/src/commands/scheduler.ts packages/cli/src/commands/doctor.ts
git commit -m "feat(cli): render commands with shared UI"
```

---

### Task 9: Add JSON Support Guards and Error Classification

**Files:**
- Create: `packages/cli/src/ui/errors.ts`
- Test: `packages/cli/src/ui/errors.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: command render tests for commands converted in Tasks 5-8

- [ ] **Step 1: Write failing error classification tests**

Create `packages/cli/src/ui/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { classifyError } from "./errors.js";

describe("classifyError", () => {
  it("classifies authentication guidance", () => {
    expect(classifyError(new Error("Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate."))).toEqual({
      code: "AUTH_REQUIRED",
      message: "Run token-burn login --server-url https://tokenburn.nayanbhut.dev to authenticate.",
      nextAction: "token-burn login",
    });
  });

  it("classifies CLI version mismatch", () => {
    expect(classifyError(new Error("Token Burn requires token-burn 2.0.0. You have 1.0.0. Run npm install -g @blnayan/token-burn@latest."))).toEqual({
      code: "CLI_VERSION_REQUIRED",
      message: "Token Burn requires token-burn 2.0.0. You have 1.0.0. Run npm install -g @blnayan/token-burn@latest.",
      nextAction: "npm install -g @blnayan/token-burn@latest",
    });
  });

  it("uses CLI_ERROR for unknown errors", () => {
    expect(classifyError(new Error("network down"))).toEqual({
      code: "CLI_ERROR",
      message: "network down",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/errors.test.ts
```

Expected: FAIL because `errors.ts` does not exist.

- [ ] **Step 3: Implement error classification**

Create `packages/cli/src/ui/errors.ts`:

```ts
import type { UiError } from "./types.js";

export function classifyError(error: unknown): UiError {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("to authenticate")) {
    return { code: "AUTH_REQUIRED", message, nextAction: "token-burn login" };
  }

  if (message.startsWith("Token Burn requires token-burn")) {
    return { code: "CLI_VERSION_REQUIRED", message, nextAction: "npm install -g @blnayan/token-burn@latest" };
  }

  if (message.includes("ccusage native binary is not executable")) {
    return { code: "CCUSAGE_BINARY_PERMISSION", message };
  }

  if (message.includes("automatic sync was not installed") || message.includes("scheduler")) {
    return { code: "SCHEDULER_ERROR", message };
  }

  if (message.includes("Device check failed") || message.includes("Cannot merge devices")) {
    return { code: "DEVICE_ERROR", message };
  }

  return { code: "CLI_ERROR", message };
}
```

- [ ] **Step 4: Use classifier in top-level catch**

In `packages/cli/src/index.ts`, import and use:

```ts
import { classifyError } from "./ui/errors.js";
```

Replace:

```ts
const message = error instanceof Error ? error.message : String(error);

ui.error({ code: "CLI_ERROR", message });
```

with:

```ts
ui.error(classifyError(error));
```

- [ ] **Step 5: Add JSON unsupported guard**

For commands without JSON result support during implementation, render only JSON error output:

```ts
ui.error({ code: "JSON_UNSUPPORTED", message: "--json is not supported for this command yet." });
process.exitCode = 1;
```

Apply the guard only to commands where `ui.result(...)` has not been implemented. After Tasks 5-8, `status`, `doctor`, `sync`, `setup`, `login`, `logout`, `devices`, and scheduler commands should all call `ui.result(...)`, so no command should need the guard except future commands.

- [ ] **Step 6: Run error tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test -- src/ui/errors.test.ts src/index.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/ui/errors.ts packages/cli/src/ui/errors.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): classify rendered errors"
```

---

### Task 10: Update Documentation and Verify Full CLI

**Files:**
- Modify: `packages/cli/README.md`
- Modify: `README.md`
- Modify: `apps/web/src/app/setup/page.tsx`
- Modify tests for setup page copy if needed

- [ ] **Step 1: Update CLI README command list**

In `packages/cli/README.md`, keep the quick start:

```bash
npx @blnayan/token-burn@latest setup
```

Update scheduler command bullets to:

```md
- `token-burn scheduler install` installs automatic sync.
- `token-burn scheduler install --dry-run` previews scheduler changes.
- `token-burn scheduler uninstall` removes automatic sync.
- `token-burn install-scheduler` and `token-burn uninstall-scheduler` remain available as compatibility aliases.
```

Add output mode bullets:

```md
## Output Modes

- Interactive terminals use rich Clean Operator output by default.
- Non-TTY output, cron, CI, and `NO_COLOR` use plain output.
- Use `--plain` for log-safe human text.
- Use `--json` for machine-readable output where supported.
- Use `--no-color` to keep rich layout without ANSI color.
```

- [ ] **Step 2: Update root README and setup page references**

Search:

```bash
rg -n "install-scheduler|uninstall-scheduler|scheduler install|scheduler uninstall" README.md apps/web/src/app/setup packages/cli/README.md
```

For human-run scheduler commands, prefer `token-burn scheduler install` and `token-burn scheduler uninstall`. Keep `npx @blnayan/token-burn@latest setup` unchanged.

- [ ] **Step 3: Update setup page tests if copy changes**

Run:

```bash
pnpm --filter @token-burn/web test -- src/app/setup/page.test.tsx src/app/setup/setup-command-copy.test.tsx
```

Expected: PASS. If a test fails due to intentional copy change, update the expected string to the new grouped command text.

- [ ] **Step 4: Run full CLI tests**

Run:

```bash
pnpm --filter @blnayan/token-burn test
pnpm --filter @blnayan/token-burn typecheck
pnpm --filter @blnayan/token-burn build
```

Expected: all commands PASS.

- [ ] **Step 5: Run repository-level verification**

Run:

```bash
pnpm test
pnpm typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/README.md README.md apps/web/src/app/setup/page.tsx apps/web/src/app/setup/page.test.tsx apps/web/src/app/setup/setup-command-copy.test.tsx
git commit -m "docs: document CLI output modes"
```

---

## Self-Review Notes

- Spec coverage: Tasks 1-3 cover mode resolution, theme, and renderers. Task 4 covers global flags and grouped scheduler command registration. Tasks 5-8 cover every command. Task 9 covers rendered error categories and JSON-only failures. Task 10 covers docs and verification.
- Placeholder scan: The plan avoids deferred work and names exact files, commands, test expectations, and code snippets for each code task.
- Type consistency: Shared types are `UiRenderer`, `UiError`, `OutputModeConfig`, `StatusResult`, `DoctorResult`, `SyncResult`, `LoginResult`, `SetupResult`, and `LogoutResult`; later tasks reference those exact names.
