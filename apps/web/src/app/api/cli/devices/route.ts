import { NextResponse, type NextRequest } from "next/server";

import { authenticateCliRequest } from "@/server/cli-auth";
import { listMemberDevices } from "@/server/devices";

export async function GET(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: { id: true },
    },
  });
  if (!auth.ok) return auth.response;

  return NextResponse.json(await listMemberDevices({ memberId: auth.context.member.id }));
}
