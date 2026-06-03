import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";
import { DeviceMergeConflictError, DeviceMergeError, mergeMemberDevices } from "@/server/devices";

const mergeRequestSchema = z.object({
  sourceDeviceId: z.string().min(1),
  targetDeviceId: z.string().min(1),
});

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
      member: { select: { id: true } },
    },
  });

  if (!cliToken) return unauthorized();

  const body = await request.json().catch(() => null);

  try {
    const payload = mergeRequestSchema.parse(body);
    const result = await mergeMemberDevices({
      memberId: cliToken.member.id,
      sourceDeviceId: payload.sourceDeviceId,
      targetDeviceId: payload.targetDeviceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid merge payload" }, { status: 400 });
    }

    if (error instanceof DeviceMergeConflictError) {
      return NextResponse.json({ error: error.message, conflicts: error.conflicts }, { status: 409 });
    }

    if (error instanceof DeviceMergeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
