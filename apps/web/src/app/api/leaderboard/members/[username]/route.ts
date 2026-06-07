import {
  memberUsageDetailSchema,
  memberUsageRangeSchema,
  periodSchema,
  providerSchema,
} from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";

import { getMemberUsageDetail, type MemberUsageFilters } from "@/server/leaderboard";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const rangeParam = request.nextUrl.searchParams.get("range");
  const parsedRange = rangeParam ? memberUsageRangeSchema.safeParse(rangeParam) : null;

  if (parsedRange && !parsedRange.success) {
    return NextResponse.json({ error: "Invalid usage range" }, { status: 400 });
  }

  const providerFilters: MemberUsageFilters["providers"] = [];
  for (const providerParam of request.nextUrl.searchParams.getAll("provider")) {
    const parsedProvider = providerSchema.safeParse(providerParam.trim());
    if (!parsedProvider.success) {
      return NextResponse.json({ error: "Invalid provider filter" }, { status: 400 });
    }
    providerFilters.push(parsedProvider.data);
  }

  const modelFilters: MemberUsageFilters["models"] = [];
  for (const modelParam of request.nextUrl.searchParams.getAll("model")) {
    const separatorIndex = modelParam.indexOf(":");
    if (separatorIndex <= 0) {
      return NextResponse.json({ error: "Invalid model filter" }, { status: 400 });
    }

    const providerPart = modelParam.slice(0, separatorIndex).trim();
    const modelName = modelParam.slice(separatorIndex + 1).trim();
    const parsedProvider = providerSchema.safeParse(providerPart);
    if (!parsedProvider.success || modelName.length === 0) {
      return NextResponse.json({ error: "Invalid model filter" }, { status: 400 });
    }

    modelFilters.push({ provider: parsedProvider.data, modelName });
  }

  if (providerFilters.length > 0 && modelFilters.length > 0) {
    return NextResponse.json(
      { error: "Provider and model filters cannot be combined" },
      { status: 400 },
    );
  }

  const deviceFilters: MemberUsageFilters["devices"] = [];
  for (const deviceParam of request.nextUrl.searchParams.getAll("device")) {
    const device = deviceParam.trim();
    if (device.length === 0) {
      return NextResponse.json({ error: "Invalid device filter" }, { status: 400 });
    }
    deviceFilters.push(device);
  }

  const filters: MemberUsageFilters = {
    providers: providerFilters,
    models: modelFilters,
    devices: deviceFilters,
  };

  const period =
    parsedRange?.data ??
    periodSchema.catch("daily").parse(request.nextUrl.searchParams.get("period") ?? undefined);
  const detail = await getMemberUsageDetail(username, period, new Date(), filters);

  if (!detail) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  return NextResponse.json(memberUsageDetailSchema.parse(detail));
}
