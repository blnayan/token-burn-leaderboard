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
    expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
      "ada",
      {
        period: "weekly",
        filters: {
          providers: [],
          models: [],
          devices: [],
        },
      },
      expect.any(Date),
    );
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
    expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
      "ada",
      {
        period: "30d",
        filters: {
          providers: [],
          models: [],
          devices: [],
        },
      },
      expect.any(Date),
    );
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

    expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
      "ada",
      {
        period: "daily",
        filters: {
          providers: [],
          models: [],
          devices: [],
        },
      },
      expect.any(Date),
    );
  });

  it("passes valid repeated provider, model, and device filters", async () => {
    getMemberUsageDetailMock.mockResolvedValue({
      member: { username: "ada", displayName: "Ada" },
      period: "7d",
      summary: { rank: null, totalTokens: 0, totalCostUsd: 0 },
      trend: [],
      providers: [],
      models: [],
      devices: [],
    });

    const response = await GET(
      new NextRequest(
        "https://token-burn.test/api/leaderboard/members/ada?range=7d&provider=codex&provider=claude_code&device=device-1&device=device-2",
      ),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(200);
    expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
      "ada",
      {
        period: "7d",
        filters: {
          providers: ["codex", "claude_code"],
          models: [],
          devices: ["device-1", "device-2"],
        },
      },
      expect.any(Date),
    );

    getMemberUsageDetailMock.mockClear();
    const modelResponse = await GET(
      new NextRequest(
        "https://token-burn.test/api/leaderboard/members/ada?range=7d&model=codex:gpt-5-codex&model=claude_code:opus&device=device-1",
      ),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(modelResponse.status).toBe(200);
    expect(getMemberUsageDetailMock).toHaveBeenCalledWith(
      "ada",
      {
        period: "7d",
        filters: {
          providers: [],
          models: [
            { provider: "codex", modelName: "gpt-5-codex" },
            { provider: "claude_code", modelName: "opus" },
          ],
          devices: ["device-1"],
        },
      },
      expect.any(Date),
    );
  });

  it("rejects invalid provider filters", async () => {
    const response = await GET(
      new NextRequest("https://token-burn.test/api/leaderboard/members/ada?provider=other"),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(400);
    expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Invalid provider filter" });
  });

  it("rejects invalid model filter formats", async () => {
    const response = await GET(
      new NextRequest("https://token-burn.test/api/leaderboard/members/ada?model=codex"),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(400);
    expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Invalid model filter" });
  });

  it("rejects blank device filters", async () => {
    const response = await GET(
      new NextRequest("https://token-burn.test/api/leaderboard/members/ada?device=%20"),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(400);
    expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: "Invalid device filter" });
  });

  it("rejects provider and model filters together", async () => {
    const response = await GET(
      new NextRequest("https://token-burn.test/api/leaderboard/members/ada?provider=codex&model=codex:gpt-5-codex"),
      { params: Promise.resolve({ username: "ada" }) },
    );

    expect(response.status).toBe(400);
    expect(getMemberUsageDetailMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Provider and model filters cannot be combined",
    });
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
