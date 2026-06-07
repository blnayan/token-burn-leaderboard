import type { LeaderboardPeriod } from "@token-burn/shared";

type ClosedPeriod = Exclude<LeaderboardPeriod, "all-time">;
type ClosedPeriodRange = { start: Date; end: Date };
type OpenPeriodRange = { start: null; end: null };
type PeriodRange = ClosedPeriodRange | OpenPeriodRange;

export function getPeriodRange(period: "all-time", now?: Date): OpenPeriodRange;
export function getPeriodRange(period: ClosedPeriod, now?: Date): ClosedPeriodRange;
export function getPeriodRange(period: LeaderboardPeriod, now?: Date): PeriodRange;
export function getPeriodRange(period: LeaderboardPeriod, now = new Date()): PeriodRange {
  if (period === "all-time") return { start: null, end: null };

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();

  if (period === "daily") {
    const start = new Date(Date.UTC(year, month, date));
    return { start, end: addUtcDays(start, 1) };
  }

  if (period === "monthly") {
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 1));
    return { start, end };
  }

  const day = now.getUTCDay() || 7;
  const start = new Date(Date.UTC(year, month, date - day + 1));
  return { start, end: addUtcDays(start, 7) };
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function getRecentUtcDateWindow(days: number, now = new Date()): string[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("UTC date window must include at least one day");
  }

  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = addUtcDays(end, -(days - 1));
  const dates: string[] = [];

  for (let date = start; date <= end; date = addUtcDays(date, 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }

  return dates;
}
