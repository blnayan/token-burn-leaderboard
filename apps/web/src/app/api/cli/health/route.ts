import { NextResponse } from "next/server";

import { requiredCliVersion } from "@/server/cli-version";

export async function GET() {
  return NextResponse.json({
    requiredCliVersion,
    serverTime: new Date().toISOString(),
  });
}
