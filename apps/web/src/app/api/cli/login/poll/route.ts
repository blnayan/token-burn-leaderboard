import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { createCliToken, createCliTokenExpiration, hashSecret, isCliLoginExpired } from "@/server/cli-auth";

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
      member: { select: { displayName: true, username: true } },
    },
  });

  if (!session || isCliLoginExpired(session.expiresAt)) {
    return NextResponse.json({ error: "Login session is invalid or expired" }, { status: 404 });
  }

  if (!session.approvedAt || !session.memberId || !session.member) {
    return NextResponse.json({ status: "pending" });
  }

  const memberId = session.memberId;
  const displayName = session.member.displayName;
  const username = session.member.username;
  const token = createCliToken();
  const consumed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.cliLoginSession.deleteMany({
      where: {
        id: session.id,
        approvedAt: { not: null },
        memberId,
        expiresAt: { gt: new Date() },
      },
    });

    if (deleted.count !== 1) return false;

    await tx.cliToken.create({
      data: {
        tokenHash: hashSecret(token),
        memberId,
        label: "CLI",
        expiresAt: createCliTokenExpiration(),
      },
    });

    return true;
  });

  if (!consumed) {
    return NextResponse.json({ error: "Login session is invalid or expired" }, { status: 410 });
  }

  return NextResponse.json({
    status: "approved",
    token,
    member: { displayName, username },
  });
}
