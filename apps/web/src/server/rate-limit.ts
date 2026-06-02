import { NextResponse, type NextRequest } from "next/server";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const globalForRateLimit = globalThis as unknown as {
  tokenBurnRateLimits?: Map<string, RateLimitBucket>;
};

const buckets = globalForRateLimit.tokenBurnRateLimits ?? new Map<string, RateLimitBucket>();
globalForRateLimit.tokenBurnRateLimits = buckets;

export function checkRateLimit({ key, limit, windowMs, now = new Date() }: RateLimitOptions): RateLimitResult {
  const timestamp = now.getTime();
  const existing = buckets.get(key);
  const bucket = existing && existing.resetAt > timestamp ? existing : { count: 0, resetAt: timestamp + windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, limit - bucket.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));

  return {
    ok: bucket.count <= limit,
    limit,
    remaining,
    retryAfterSeconds,
  };
}

export function buildClientRateLimitKey(request: NextRequest, prefix: string): string {
  return `${prefix}:${readClientIp(request)}`;
}

export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

function readClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) return forwardedFor;

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}
