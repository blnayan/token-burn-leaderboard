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
