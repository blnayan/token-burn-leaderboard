import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    cliToken: { findFirst: vi.fn() },
  },
}));

vi.mock("@/server/devices", async () => {
  const actual = await vi.importActual<typeof import("@/server/devices")>("@/server/devices");
  return {
    ...actual,
    mergeMemberDevices: vi.fn(),
  };
});

import { prisma } from "@/lib/prisma";
import { DeviceMergeError, mergeMemberDevices } from "@/server/devices";

import { POST } from "./route";

const prismaMock = prisma as unknown as { cliToken: { findFirst: ReturnType<typeof vi.fn> } };
const mergeMemberDevicesMock = mergeMemberDevices as unknown as ReturnType<typeof vi.fn>;

describe("POST /api/cli/devices/merge", () => {
  beforeEach(() => {
    prismaMock.cliToken.findFirst.mockReset();
    mergeMemberDevicesMock.mockReset();
  });

  it("rejects missing auth", async () => {
    const response = await POST(request({ sourceDeviceId: "source", targetDeviceId: "target" }, false));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("rejects invalid merge payloads", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });

    const response = await POST(request({ sourceDeviceId: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid merge payload" });
  });

  it("returns device merge domain errors", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });
    mergeMemberDevicesMock.mockRejectedValue(
      new DeviceMergeError("Both devices must exist for the authenticated member."),
    );

    const response = await POST(request({ sourceDeviceId: "source", targetDeviceId: "target" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Both devices must exist for the authenticated member.",
    });
  });

  it("merges devices for the authenticated member", async () => {
    prismaMock.cliToken.findFirst.mockResolvedValue({ member: { id: "member-1" } });
    mergeMemberDevicesMock.mockResolvedValue({
      sourceDeviceId: "source",
      targetDeviceId: "target",
      deletedDuplicateRows: 1,
      movedRows: 2,
      resolvedConflictRows: 0,
      deletedSourceDevice: true,
    });

    const response = await POST(request({ sourceDeviceId: "source", targetDeviceId: "target" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sourceDeviceId: "source",
      targetDeviceId: "target",
      deletedDuplicateRows: 1,
      movedRows: 2,
      resolvedConflictRows: 0,
      deletedSourceDevice: true,
    });
  });
});

function request(body: unknown, withAuth = true) {
  return new NextRequest("https://token-burn.test/api/cli/devices/merge", {
    method: "POST",
    headers: {
      ...(withAuth ? { authorization: "Bearer tb_secret" } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
