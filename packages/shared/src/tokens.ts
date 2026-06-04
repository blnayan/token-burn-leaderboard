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
  if (!Number.isFinite(value)) {
    throw new Error("Token totals must be finite numbers");
  }
  if (value < 0) {
    throw new Error("Token totals cannot be negative");
  }
  if (value >= 1_000_000_000) return `${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trim(value / 1_000)}K`;
  return `${Math.trunc(value)}`;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Cost totals must be finite numbers");
  }
  if (value < 0) {
    throw new Error("Cost totals cannot be negative");
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function trim(value: number): string {
  return (Math.trunc(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
}
