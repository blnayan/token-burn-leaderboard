import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";

export async function GET(request: NextRequest) {
  const token = readBearerToken(request);
  if (!token) return unauthorized();

  const cliToken = await prisma.cliToken.findFirst({
    where: {
      tokenHash: hashSecret(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      member: {
        select: {
          displayName: true,
          username: true,
        },
      },
    },
  });

  if (!cliToken) return unauthorized();

  return NextResponse.json({
    authenticated: true,
    member: {
      displayName: cliToken.member.displayName,
      ...(cliToken.member.username ? { username: cliToken.member.username } : {}),
    },
  });
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
