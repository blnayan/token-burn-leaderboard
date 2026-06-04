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

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    member: {
      update: vi.fn(),
    },
  },
}));

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import { updateDisplayName } from "./page";

const authMock = auth as unknown as {
  mockReset: () => void;
  mockResolvedValue: (value: { user: { githubId: string }; expires: string }) => void;
};

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  member: {
    update: ReturnType<typeof vi.fn>;
  };
};

describe("updateDisplayName", () => {
  beforeEach(() => {
    authMock.mockReset();
    prismaMock.user.findUnique.mockReset();
    prismaMock.member.update.mockReset();

    authMock.mockResolvedValue({
      user: {
        githubId: "github-1",
      },
      expires: "2026-06-04T00:00:00.000Z",
    });
    prismaMock.user.findUnique.mockResolvedValue({ member: { id: "member-1" } });
    prismaMock.member.update.mockResolvedValue({});
  });

  it("allows a display name that another member may already use", async () => {
    const formData = new FormData();
    formData.set("displayName", "Nayan");

    let redirectError: unknown;
    try {
      await updateDisplayName({ message: null }, formData);
    } catch (error) {
      redirectError = error;
    }

    expect(prismaMock.member.update).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: { displayName: "Nayan" },
    });
    expect(() => {
      throw redirectError;
    }).toThrow("NEXT_REDIRECT:/");
  });
});
