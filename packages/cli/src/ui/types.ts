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
