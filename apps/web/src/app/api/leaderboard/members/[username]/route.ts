import { memberUsageDetailSchema } from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getMemberUsageDetail } from "@/server/leaderboard";
import { MemberUsageQueryError, parseMemberUsageQuery } from "@/server/member-usage-query";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  let query;
  try {
    query = parseMemberUsageQuery(request.nextUrl.searchParams);
  } catch (error) {
    if (error instanceof MemberUsageQueryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const detail = await getMemberUsageDetail(username, query, new Date());

  if (!detail) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  return NextResponse.json(memberUsageDetailSchema.parse(detail));
}
