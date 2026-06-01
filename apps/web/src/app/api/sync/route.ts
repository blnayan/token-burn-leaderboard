import { syncPayloadSchema } from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";
import { persistSyncPayload } from "@/server/sync-ingest";

export async function POST(request: NextRequest) {
  const token = readBearerToken(request);
  if (!token) return unauthorized();

  const cliToken = await prisma.cliToken.findFirst({
    where: {
      tokenHash: hashSecret(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      member: { select: { id: true } },
    },
  });

  if (!cliToken) return unauthorized();

  const body = await request.json().catch(() => null);

  try {
    const payload = syncPayloadSchema.parse(body);

    await persistSyncPayload({
      cliTokenId: cliToken.id,
      memberId: cliToken.member.id,
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

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
