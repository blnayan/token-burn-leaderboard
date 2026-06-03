import { NextResponse } from "next/server";

const recommendedCliVersion = "0.1.5";
const minimumCliVersion = "0.1.5";

export async function GET() {
  return NextResponse.json({
    recommendedCliVersion,
    minimumCliVersion,
    serverTime: new Date().toISOString(),
  });
}
