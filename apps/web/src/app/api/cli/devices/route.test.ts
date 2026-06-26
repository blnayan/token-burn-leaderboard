import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: { findFirst: vi.fn() },
  },
}));

vi.mock("@/server/devices", () => ({
  listMemberDevices: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { listMemberDevices } from "@/server/devices";

import { GET } from "./route";

const prismaMock = prisma as unknown as { cliToken: { findFirst: ReturnType<typeof vi.fn> } };
const listMemberDevicesMock = listMemberDevices as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/cli/devices", () => {
  beforeEach(() => {
    prismaMock.cliToken.findFirst.mockReset();
    listMemberDevicesMock.mockReset();
  });

  it("rejects missing auth", async () => {
    const response = await GET(new NextRequest("https://token-burn.test/api/cli/devices"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(listMemberDevicesMock).not.toHaveBeenCalled();
  });

  it("lists devices for the authenticated member", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });
    listMemberDevicesMock.mockResolvedValue({ devices: [], duplicateGroups: [] });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ devices: [], duplicateGroups: [] });
    expect(listMemberDevicesMock).toHaveBeenCalledWith({ memberId: "member-1" });
  });
});

function request() {
  return new NextRequest("https://token-burn.test/api/cli/devices", {
    headers: { authorization: "Bearer tb_secret" },
  });
}
