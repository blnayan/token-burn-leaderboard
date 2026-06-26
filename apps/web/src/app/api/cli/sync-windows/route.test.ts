import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providers } from "@token-burn/shared";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: {
      findFirst: vi.fn(),
    },
    dailyProviderUsage: {
      groupBy: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

import { GET } from "./route";

const prismaMock = prisma as unknown as {
  cliToken: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  dailyProviderUsage: {
    groupBy: ReturnType<typeof vi.fn>;
  };
};

describe("GET /api/cli/sync-windows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prismaMock.cliToken.findFirst.mockReset();
    prismaMock.dailyProviderUsage.groupBy.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns provider sync windows for an authenticated CLI token", async () => {
    vi.setSystemTime(new Date("2026-06-06T12:00:00.000Z"));
    prismaMock.cliToken.findFirst.mockResolvedValue({
      member: { id: "member-1" },
    });
    prismaMock.dailyProviderUsage.groupBy.mockResolvedValue([
      { provider: "codex", _max: { syncedAt: new Date("2026-06-06T01:15:00.000Z") } },
    ]);

    const response = await GET(
      request(
        "https://token-burn.test/api/cli/sync-windows?deviceId=4f43b27d-7d86-4ff8-8c98-f74158819e59",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      serverTime: "2026-06-06T12:00:00.000Z",
      until: "2026-06-06",
      providers: providers.map((provider) =>
        provider === "codex" ? { provider, since: "2026-06-06" } : { provider },
      ),
    });
  });

  it("rejects missing auth", async () => {
    const response = await GET(
      new NextRequest(
        "https://token-burn.test/api/cli/sync-windows?deviceId=4f43b27d-7d86-4ff8-8c98-f74158819e59",
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns unauthorized when no valid CLI token exists", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue(null);

    const response = await GET(
      request(
        "https://token-burn.test/api/cli/sync-windows?deviceId=4f43b27d-7d86-4ff8-8c98-f74158819e59",
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects invalid device IDs", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({
      member: { id: "member-1" },
    });

    const response = await GET(
      request("https://token-burn.test/api/cli/sync-windows?deviceId=not-a-uuid"),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid sync windows request" });
  });
});

function request(url: string): NextRequest {
  return new NextRequest(url, {
    headers: {
      authorization: "Bearer secret",
    },
  });
}
