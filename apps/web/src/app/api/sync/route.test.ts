import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/server/sync-ingest", () => ({
  persistSyncPayload: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { requiredCliVersion } from "@/server/cli-version";
import { persistSyncPayload } from "@/server/sync-ingest";

import { POST } from "./route";

const prismaMock = prisma as unknown as {
  cliToken: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

const persistSyncPayloadMock = persistSyncPayload as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/sync CLI version enforcement", () => {
  const nonRequiredCliVersion = createDifferentVersion(requiredCliVersion);

  beforeEach(() => {
    prismaMock.cliToken.findFirst.mockReset();
    persistSyncPayloadMock.mockReset();
    prismaMock.cliToken.findFirst.mockResolvedValue({
      id: "cli-token-1",
      member: { id: "member-1" },
    });
  });

  it("rejects sync payloads from non-required CLI versions", async () => {
    const response = await POST(createSyncRequest({ cliVersion: nonRequiredCliVersion }));

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toEqual({
      error: `Token Burn requires token-burn ${requiredCliVersion}. You have ${nonRequiredCliVersion}. Run npm install -g @blnayan/token-burn@latest.`,
      requiredCliVersion,
    });
    expect(persistSyncPayloadMock).not.toHaveBeenCalled();
  });

  it("persists sync payloads for authenticated CLI tokens", async () => {
    const response = await POST(createSyncRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(persistSyncPayloadMock).toHaveBeenCalledWith({
      cliTokenId: "cli-token-1",
      memberId: "member-1",
      payload: expect.objectContaining({
        provider: "codex",
        cliVersion: requiredCliVersion,
      }),
    });
  });
});

function createSyncRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest("https://token-burn.test/api/sync", {
    method: "POST",
    headers: {
      authorization: "Bearer tb_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: "codex",
      date: "2026-05-31",
      tokenCategories: { input: 1 },
      totalTokens: 1,
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "nayan-vps",
      cliVersion: requiredCliVersion,
      ccusageVersion: "20.0.6",
      os: "linux",
      syncedAt: "2026-06-01T00:00:00.000Z",
      ...overrides,
    }),
  });
}

function createDifferentVersion(version: string): string {
  const major = Number(version.split(".")[0] ?? 0);

  return `${major + 1}.0.0`;
}
