import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { createCliToken, hashSecret, isCliLoginExpired } from "@/server/cli-auth";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { pollToken?: unknown } | null;
  const pollToken = typeof body?.pollToken === "string" ? body.pollToken : "";

  if (!pollToken) {
    return NextResponse.json({ error: "pollToken is required" }, { status: 400 });
  }

  const session = await prisma.cliLoginSession.findUnique({
    where: { pollTokenHash: hashSecret(pollToken) },
    select: {
      id: true,
      approvedAt: true,
      expiresAt: true,
      memberId: true,
      member: { select: { displayName: true } },
    },
  });

  if (!session || isCliLoginExpired(session.expiresAt)) {
    return NextResponse.json({ error: "Login session is invalid or expired" }, { status: 404 });
  }

  if (!session.approvedAt || !session.memberId || !session.member) {
    return NextResponse.json({ status: "pending" });
  }

  const token = createCliToken();
  await prisma.$transaction([
    prisma.cliToken.create({
      data: {
        tokenHash: hashSecret(token),
        memberId: session.memberId,
        label: "CLI",
      },
    }),
    prisma.cliLoginSession.delete({
      where: { id: session.id },
    }),
  ]);

  return NextResponse.json({
    status: "approved",
    token,
    member: { displayName: session.member.displayName },
  });
}
