import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { authenticateCliRequest } from "@/server/cli-auth";
import { buildSyncWindows } from "@/server/sync-windows";

const querySchema = z.object({
  deviceId: z.string().uuid(),
});

export async function GET(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: {
        id: true,
      },
    },
  });
  if (!auth.ok) return auth.response;

  const parsed = querySchema.safeParse({
    deviceId: request.nextUrl.searchParams.get("deviceId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync windows request" }, { status: 400 });
  }

  const windows = await buildSyncWindows({
    memberId: auth.context.member.id,
    clientDeviceId: parsed.data.deviceId,
  });

  return NextResponse.json(windows);
}
