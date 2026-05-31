export type TokenCategories = Record<string, number>;

export function sumTokenCategories(categories: TokenCategories): number {
  return Object.values(categories).reduce((total, value) => {
    if (!Number.isFinite(value)) {
      throw new Error("Token totals must be finite numbers");
    }
    if (value < 0) {
      throw new Error("Token totals cannot be negative");
    }
    return total + Math.trunc(value);
  }, 0);
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return `${Math.trunc(value)}`;
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}
