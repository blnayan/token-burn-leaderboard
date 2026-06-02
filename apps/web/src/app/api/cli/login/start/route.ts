import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createCliLoginCode, createCliLoginExpiration, createCliToken, hashSecret } from "@/server/cli-auth";
import { buildClientRateLimitKey, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";

const loginStartLimit = {
  limit: 20,
  windowMs: 10 * 60 * 1000,
};

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit({
    key: buildClientRateLimitKey(request, "cli-login-start"),
    ...loginStartLimit,
  });
  if (!rateLimit.ok) return rateLimitResponse(rateLimit);

  const code = createCliLoginCode();
  const pollToken = createCliToken();
  const expiresAt = createCliLoginExpiration();

  await prisma.cliLoginSession.create({
    data: {
      codeHash: hashSecret(code),
      pollTokenHash: hashSecret(pollToken),
      expiresAt,
    },
  });

  return NextResponse.json({
    loginUrl: `${env.TOKEN_BURN_PUBLIC_URL.replace(/\/$/, "")}/cli/approve/${code}`,
    pollToken,
    expiresAt: expiresAt.toISOString(),
  });
}
