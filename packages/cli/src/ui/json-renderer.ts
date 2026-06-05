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
