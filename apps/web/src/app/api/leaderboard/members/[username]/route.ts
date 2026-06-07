import { memberUsageDetailSchema, periodSchema } from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getMemberUsageDetail } from "@/server/leaderboard";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const period = periodSchema.catch("daily").parse(request.nextUrl.searchParams.get("period") ?? undefined);
  const detail = await getMemberUsageDetail(username, period);

  if (!detail) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  return NextResponse.json(memberUsageDetailSchema.parse(detail));
}
