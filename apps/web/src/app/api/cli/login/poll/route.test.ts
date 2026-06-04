import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliLoginSession: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    cliToken: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/cli-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/cli-auth")>("@/server/cli-auth");

  return {
    ...actual,
    createCliToken: vi.fn(() => "tb_secret"),
    createCliTokenExpiration: vi.fn(() => new Date("2026-07-01T00:00:00.000Z")),
    hashSecret: vi.fn((value: string) => `hashed-${value}`),
  };
});

import { prisma } from "@/lib/prisma";

import { POST } from "./route";

const prismaMock = prisma as unknown as {
  cliLoginSession: {
    findUnique: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  cliToken: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

describe("POST /api/cli/login/poll", () => {
  beforeEach(() => {
    prismaMock.cliLoginSession.findUnique.mockReset();
    prismaMock.cliLoginSession.deleteMany.mockReset();
    prismaMock.cliToken.create.mockReset();
    prismaMock.$transaction.mockReset();

    prismaMock.cliLoginSession.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.cliToken.create.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback) => callback(prismaMock));
  });

  it("returns the approved member username with the CLI token", async () => {
    prismaMock.cliLoginSession.findUnique.mockResolvedValue({
      id: "login-session-1",
      approvedAt: new Date("2026-06-04T00:00:00.000Z"),
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      memberId: "member-1",
      member: {
        displayName: "Nayan",
        username: "blnayan",
      },
    });

    const response = await POST(createPollRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "approved",
      token: "tb_secret",
      member: {
        displayName: "Nayan",
        username: "blnayan",
      },
    });
  });
});

function createPollRequest() {
  return new NextRequest("https://token-burn.test/api/cli/login/poll", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ pollToken: "poll-token" }),
  });
}
