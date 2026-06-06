import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";
import { buildSyncWindows } from "@/server/sync-windows";

const querySchema = z.object({
  deviceId: z.string().uuid(),
});

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
          id: true,
        },
      },
    },
  });

  if (!cliToken) return unauthorized();

  const parsed = querySchema.safeParse({
    deviceId: request.nextUrl.searchParams.get("deviceId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync windows request" }, { status: 400 });
  }

  const windows = await buildSyncWindows({
    memberId: cliToken.member.id,
    clientDeviceId: parsed.data.deviceId,
  });

  return NextResponse.json(windows);
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
