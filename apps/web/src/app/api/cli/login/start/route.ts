import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createCliLoginCode, createCliLoginExpiration, createCliToken, hashSecret } from "@/server/cli-auth";

export async function POST() {
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
