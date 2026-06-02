import { describe, expect, it, beforeEach } from "vitest";

import { checkRateLimit, resetRateLimitsForTests } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("allows requests until the limit is reached", () => {
    const now = new Date("2026-06-02T00:00:00.000Z");

    expect(checkRateLimit({ key: "login:127.0.0.1", limit: 2, windowMs: 60_000, now })).toMatchObject({
      ok: true,
      remaining: 1,
    });
    expect(checkRateLimit({ key: "login:127.0.0.1", limit: 2, windowMs: 60_000, now })).toMatchObject({
      ok: true,
      remaining: 0,
    });
    expect(checkRateLimit({ key: "login:127.0.0.1", limit: 2, windowMs: 60_000, now })).toMatchObject({
      ok: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it("resets the bucket after the window expires", () => {
    const key = "sync:token";

    expect(
      checkRateLimit({ key, limit: 1, windowMs: 60_000, now: new Date("2026-06-02T00:00:00.000Z") }),
    ).toMatchObject({ ok: true, remaining: 0 });
    expect(
      checkRateLimit({ key, limit: 1, windowMs: 60_000, now: new Date("2026-06-02T00:01:00.000Z") }),
    ).toMatchObject({ ok: true, remaining: 0 });
  });
});
