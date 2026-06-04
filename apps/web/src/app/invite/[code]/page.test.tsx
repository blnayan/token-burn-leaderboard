import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      upsert: vi.fn(),
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
  mockResolvedValue: (value: {
    user: { githubId: string; githubLogin?: string; name?: string | null };
    expires: string;
  }) => void;
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
    upsert: MockFn;
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

const txMemberUpsertMock = vi.fn();
const txInviteUpdateManyMock = vi.fn();

describe("acceptInvite", () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockReset();
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.upsert.mockReset();
    prismaMock.invite.findUnique.mockReset();
    prismaMock.invite.updateMany.mockReset();
    prismaMock.member.upsert.mockReset();
    prismaMock.$transaction.mockReset();
    txMemberUpsertMock.mockReset();
    txInviteUpdateManyMock.mockReset();

    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
        githubLogin: "blnayan",
        name: "Nayan Bhut",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      githubLogin: "blnayan",
      githubName: "Nayan Bhut",
    });
    prismaMock.user.upsert.mockResolvedValue({
      id: "user-1",
      githubLogin: "blnayan",
      githubName: "Nayan Bhut",
    });
    prismaMock.invite.findUnique.mockResolvedValue({
      id: "invite-1",
      redeemedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
    });
    txMemberUpsertMock.mockResolvedValue({});
    txInviteUpdateManyMock.mockResolvedValue({ count: 1 });
    prismaMock.$transaction.mockImplementation(async (callback) => {
      await callback({
        member: {
          upsert: txMemberUpsertMock,
        },
        invite: {
          updateMany: txInviteUpdateManyMock,
        },
      });
    });
  });

  it("redirects accepted invites to setup instructions", async () => {
    const formData = new FormData();
    formData.set("code", "abc123");

    let redirectError: unknown;
    try {
      await acceptInvite(formData);
    } catch (error) {
      redirectError = error;
    }

    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(txMemberUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "user-1",
          username: "blnayan",
          displayName: "Nayan Bhut",
        }),
        where: {
          userId: "user-1",
        },
      }),
    );
    expect(txInviteUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "invite-1",
          redeemedAt: null,
        }),
      }),
    );
    expect(() => {
      throw redirectError;
    }).toThrow("NEXT_REDIRECT:/setup");
    expect(redirectMock.mock.calls.at(-1)).toEqual(["/setup"]);
  });

  it("recreates a missing user from a stale signed session before accepting an invite", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("code", "abc123");

    let redirectError: unknown;
    try {
      await acceptInvite(formData);
    } catch (error) {
      redirectError = error;
    }

    expect(prismaMock.user.upsert).toHaveBeenCalledWith({
      where: { githubId: "github-1" },
      create: {
        githubId: "github-1",
        githubLogin: "blnayan",
        githubName: "Nayan Bhut",
      },
      update: {
        githubLogin: "blnayan",
        githubName: "Nayan Bhut",
      },
      select: {
        id: true,
        githubLogin: true,
        githubName: true,
      },
    });
    expect(txMemberUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          userId: "user-1",
          username: "blnayan",
          displayName: "Nayan Bhut",
        }),
      }),
    );
    expect(() => {
      throw redirectError;
    }).toThrow("NEXT_REDIRECT:/setup");
  });
});
