import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/env", () => ({
  env: {
    TOKEN_BURN_PUBLIC_URL: "https://tokenburn.example.com",
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    invite: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    member: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { acceptInvite } from "./page";

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: { user: { githubId: string }; expires: string }) => void;
};

const redirectMock = redirect as unknown as {
  mockReset: () => void;
  mockImplementation: (implementation: (url: string) => never) => void;
  mock: { calls: Array<[string]> };
};

type MockFn = {
  mockReset: () => void;
  mockResolvedValue: (value: unknown) => void;
};

type TransactionClientMock = {
  member: {
    upsert: MockFn;
  };
  invite: {
    updateMany: MockFn;
  };
};

type TransactionMockFn = {
  mockReset: () => void;
  mockImplementation: (implementation: (callback: (tx: TransactionClientMock) => Promise<void>) => Promise<void>) => void;
};

const prismaMock = prisma as unknown as {
  user: {
    findUnique: MockFn;
  };
  invite: {
    findUnique: MockFn;
    updateMany: MockFn;
  };
  member: {
    upsert: MockFn;
  };
  $transaction: TransactionMockFn;
};

describe("acceptInvite", () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockReset();
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
    prismaMock.user.findUnique.mockReset();
    prismaMock.invite.findUnique.mockReset();
    prismaMock.invite.updateMany.mockReset();
    prismaMock.member.upsert.mockReset();
    prismaMock.$transaction.mockReset();

    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1" });
    prismaMock.invite.findUnique.mockResolvedValue({
      id: "invite-1",
      redeemedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    prismaMock.member.upsert.mockResolvedValue({});
    prismaMock.invite.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (callback) => {
      await callback({
        member: prismaMock.member,
        invite: prismaMock.invite,
      });
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("redirects accepted invites to setup instructions", async () => {
    const formData = new FormData();
    formData.set("code", "abc123");

    await expect(acceptInvite(formData)).rejects.toThrow("NEXT_REDIRECT:/setup");

    expect(redirectMock.mock.calls.at(-1)).toEqual(["/setup"]);
  });
});
