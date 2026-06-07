import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/leaderboard", () => ({
  getMemberUsageDetail: vi.fn(),
}));

import { getMemberUsageDetail } from "@/server/leaderboard";

import { GET } from "./route";

const getMemberUsageDetailMock = getMemberUsageDetail as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/leaderboard/members/[username]", () => {
  beforeEach(() => {
    getMemberUsageDetailMock.mockReset();
  });

  it("returns public member usage detail", async () => {
    getMemberUsageDetailMock.mockResolvedValue({
      member: { username: "ada", displayName: "Ada" },
      period: "weekly",
      summary: { rank: null, totalTokens: 100, totalCostUsd: 1.25 },
      trend: [],
      providers: [],
      models: [],
      devices: [],
    });

    const response = await GET(
      new NextRequest("https://token-burn.test/api/leaderboard/members/ada?period=weekly"),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(200);
    expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "weekly");
    await expect(response.json()).resolves.toMatchObject({
      member: { username: "ada" },
      period: "weekly",
    });
  });

  it("passes dialog usage ranges to the member usage detail loader", async () => {
    getMemberUsageDetailMock.mockResolvedValue({
      member: { username: "ada", displayName: "Ada" },
      period: "30d",
      summary: { rank: null, totalTokens: 100, totalCostUsd: 1.25 },
      trend: [],
      providers: [],
      models: [],
      devices: [],
    });

    const response = await GET(
      new NextRequest("https://token-burn.test/api/leaderboard/members/ada?range=30d"),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(200);
    expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "30d");
    await expect(response.json()).resolves.toMatchObject({
      member: { username: "ada" },
      period: "30d",
    });
  });

  it("rejects invalid dialog usage ranges", async () => {
    const response = await GET(
      new NextRequest("https://token-burn.test/api/leaderboard/members/ada?range=daily"),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(400);
    expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Invalid usage range" });
  });

  it("defaults invalid periods to daily", async () => {
    getMemberUsageDetailMock.mockResolvedValue({
      member: { username: "ada", displayName: "Ada" },
      period: "daily",
      summary: { rank: null, totalTokens: 0, totalCostUsd: 0 },
      trend: [],
      providers: [],
      models: [],
      devices: [],
    });

    await GET(new NextRequest("https://token-burn.test/api/leaderboard/members/ada?period=nope"), {
      params: Promise.resolve({ username: "ada" }),
    });

    expect(getMemberUsageDetailMock).toHaveBeenCalledWith("ada", "daily");
  });

  it("returns 404 when the member is missing", async () => {
    getMemberUsageDetailMock.mockResolvedValue(null);

    const response = await GET(new NextRequest("https://token-burn.test/api/leaderboard/members/missing"), {
      params: Promise.resolve({ username: "missing" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Member not found" });
  });
});
