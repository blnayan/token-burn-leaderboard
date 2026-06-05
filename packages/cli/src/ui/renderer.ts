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
