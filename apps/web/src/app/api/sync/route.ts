import { syncPayloadSchema } from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

import { authenticateCliRequest, unauthorizedCliResponse } from "@/server/cli-auth";
import { formatRequiredCliVersionError, requiredCliVersion } from "@/server/cli-version";
import { buildClientRateLimitKey, checkRateLimit, rateLimitResponse } from "@/server/rate-limit";
import { persistSyncPayload } from "@/server/sync-ingest";

const missingAuthLimit = {
  limit: 60,
  windowMs: 10 * 60 * 1000,
};

const syncClientLimit = {
  limit: 1_500,
  windowMs: 10 * 60 * 1000,
};

const syncTokenLimit = {
  limit: 1_000,
  windowMs: 10 * 60 * 1000,
};

export async function POST(request: NextRequest) {
  const token = readBearerTokenForRateLimit(request);
  if (!token) {
    const rateLimit = checkRateLimit({
      key: buildClientRateLimitKey(request, "sync-missing-auth"),
      ...missingAuthLimit,
    });
    if (!rateLimit.ok) return rateLimitResponse(rateLimit);

    return unauthorizedCliResponse();
  }

  const clientRateLimit = checkRateLimit({
    key: buildClientRateLimitKey(request, "sync-client"),
    ...syncClientLimit,
  });
  if (!clientRateLimit.ok) return rateLimitResponse(clientRateLimit);

  const auth = await authenticateCliRequest(request, {
    select: {
      cliToken: { id: true },
      member: { id: true },
    },
  });
  if (!auth.ok) return auth.response;

  const rateLimit = checkRateLimit({
    key: `sync-token:${auth.context.tokenHash}`,
    ...syncTokenLimit,
  });
  if (!rateLimit.ok) return rateLimitResponse(rateLimit);

  const body = await request.json().catch(() => null);

  try {
    const payload = syncPayloadSchema.parse(body);

    if (payload.cliVersion !== requiredCliVersion) {
      return NextResponse.json(
        {
          error: formatRequiredCliVersionError(payload.cliVersion),
          requiredCliVersion,
        },
        { status: 426 },
      );
    }

    await persistSyncPayload({
      cliTokenId: auth.context.cliToken.id,
      memberId: auth.context.member.id,
      payload,
    });

    return NextResponse.json({ accepted: true });
  } catch (error) {
    if (error instanceof ZodError || error instanceof RangeError) {
      return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
    }
    throw error;
  }
}

function readBearerTokenForRateLimit(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}
