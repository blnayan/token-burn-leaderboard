import { NextResponse, type NextRequest } from "next/server";

import { authenticateCliRequest } from "@/server/cli-auth";

export async function GET(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: {
        displayName: true,
        username: true,
      },
    },
  });
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    authenticated: true,
    member: {
      displayName: auth.context.member.displayName,
      ...(auth.context.member.username ? { username: auth.context.member.username } : {}),
    },
  });
}
