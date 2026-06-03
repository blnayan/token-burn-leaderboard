import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";
import { listMemberDevices } from "@/server/devices";

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
      member: { select: { id: true } },
    },
  });

  if (!cliToken) return unauthorized();

  return NextResponse.json(await listMemberDevices({ memberId: cliToken.member.id }));
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
