import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/server/cli-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/cli-auth")>(
    "@/server/cli-auth",
  );

  return {
    ...actual,
    hashSecret: vi.fn((value: string) => `hashed-${value}`),
  };
});

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";

import { GET } from "./route";

const prismaMock = prisma as unknown as {
  cliToken: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

const hashSecretMock = hashSecret as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/cli/auth", () => {
  beforeEach(() => {
    prismaMock.cliToken.findFirst.mockReset();
    hashSecretMock.mockClear();
  });

  it("returns unauthorized without a bearer token", async () => {
    const response = await GET(
      new NextRequest("https://token-burn.test/api/cli/auth"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(prismaMock.cliToken.findFirst).not.toHaveBeenCalled();
  });

  it("returns unauthorized when no valid CLI token exists", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue(null);

    const response = await GET(createAuthRequest("tb_missing"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(hashSecretMock).toHaveBeenCalledWith("tb_missing");
    expect(prismaMock.cliToken.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: "hashed-tb_missing",
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        member: {
          select: {
            displayName: true,
            username: true,
          },
        },
      },
    });
  });

  it("returns authenticated member data for a valid CLI token", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({
      member: {
        displayName: "Nayan",
        username: "blnayan",
      },
    });

    const response = await GET(createAuthRequest("tb_secret"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      member: {
        displayName: "Nayan",
        username: "blnayan",
      },
    });
  });
});

function createAuthRequest(token: string) {
  return new NextRequest("https://token-burn.test/api/cli/auth", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });
}
