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
  const detail = (item: UiDetail) => `  ${paint.dim(item.label.padEnd(4))}  ${item.value}`;

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
      for (const row of formatRichTable(table)) write(row);
    },
    summary(title, details = []) {
      if (quiet) return;
      write(paint.bold(title));
      for (const item of details) write(detail(item));
    },
    nextAction(message) {
      if (quiet) return;
      write(`  ${paint.dim("Next".padEnd(4))}  ${message}`);
    },
    error(error: UiError) {
      write(`${paint.red(cleanOperatorTheme.symbols.error)} ${error.message}`);
      if (error.nextAction) write(`  ${paint.dim("Next".padEnd(4))}  ${error.nextAction}`);
    },
    result() {},
  };
}

function formatRichTable({ columns, rows }: UiTable): string[] {
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();

  return [formatRow(columns), ...rows.map(formatRow)];
}

function createNoColor(): typeof pc {
  const identity = (value: string) => value;

  return new Proxy(pc, {
    get() {
      return identity;
    },
  });
}
