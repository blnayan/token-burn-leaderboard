import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError } from "zod";

import { authenticateCliRequest } from "@/server/cli-auth";
import { DeviceMergeError, mergeMemberDevices } from "@/server/devices";

const mergeRequestSchema = z.object({
  sourceDeviceId: z.string().min(1),
  targetDeviceId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await authenticateCliRequest(request, {
    select: {
      member: { id: true },
    },
  });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);

  try {
    const payload = mergeRequestSchema.parse(body);
    const result = await mergeMemberDevices({
      memberId: auth.context.member.id,
      sourceDeviceId: payload.sourceDeviceId,
      targetDeviceId: payload.targetDeviceId,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid merge payload" }, { status: 400 });
    }

    if (error instanceof DeviceMergeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
}
