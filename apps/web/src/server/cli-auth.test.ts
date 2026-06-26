import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  authenticateCliRequest,
  createCliLoginCode,
  createCliTokenExpiration,
  hashSecret,
  isCliLoginExpired,
  unauthorizedCliResponse,
} from "./cli-auth";

function createPrismaMock(result: unknown) {
  return {
    cliToken: {
      findFirst: vi.fn().mockResolvedValue(result),
    },
  };
}

function authRequest(token = "tb_secret") {
  return new NextRequest("https://token-burn.test/api/cli/auth", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("cli auth helpers", () => {
  it("creates human-copyable login codes", () => {
    expect(createCliLoginCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("hashes secrets deterministically", () => {
    expect(hashSecret("secret")).toBe(hashSecret("secret"));
    expect(hashSecret("secret")).not.toBe("secret");
  });

  it("expires login sessions at the exact expiration time", () => {
    expect(
      isCliLoginExpired(new Date("2026-05-31T00:10:00.000Z"), new Date("2026-05-31T00:10:00.000Z")),
    ).toBe(true);
  });

  it("creates long-lived CLI token expirations", () => {
    expect(createCliTokenExpiration(new Date("2026-05-31T00:00:00.000Z")).toISOString()).toBe(
      "2027-05-31T00:00:00.000Z",
    );
  });

  it("returns unauthenticated without querying Prisma when bearer token is missing", async () => {
    const prisma = createPrismaMock({ member: { id: "member-1" } });

    const result = await authenticateCliRequest(new NextRequest("https://token-burn.test/api/cli/auth"), {
      prisma,
      select: { member: { id: true } },
    });

    expect(result.ok).toBe(false);
    expect(prisma.cliToken.findFirst).not.toHaveBeenCalled();
  });

  it("looks up non-revoked non-expired CLI tokens by hashed bearer token", async () => {
    const now = new Date("2026-06-26T12:00:00.000Z");
    const prisma = createPrismaMock({
      id: "cli-token-1",
      tokenHash: hashSecret("tb_secret"),
      member: { id: "member-1", displayName: "Nayan", username: "blnayan" },
    });

    const result = await authenticateCliRequest(authRequest(), {
      prisma,
      now: () => now,
      select: {
        cliToken: { id: true, tokenHash: true },
        member: { id: true, displayName: true, username: true },
      },
    });

    expect(result).toEqual({
      ok: true,
      context: {
        token: "tb_secret",
        tokenHash: hashSecret("tb_secret"),
        cliToken: { id: "cli-token-1", tokenHash: hashSecret("tb_secret") },
        member: { id: "member-1", displayName: "Nayan", username: "blnayan" },
      },
    });
    expect(prisma.cliToken.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: hashSecret("tb_secret"),
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        tokenHash: true,
        member: { select: { id: true, displayName: true, username: true } },
      },
    });
  });

  it("accepts bearer auth case-insensitively", async () => {
    const prisma = createPrismaMock({ member: { id: "member-1" } });
    const request = new NextRequest("https://token-burn.test/api/cli/auth", {
      headers: { authorization: "bearer tb_secret" },
    });

    const result = await authenticateCliRequest(request, {
      prisma,
      select: { member: { id: true } },
    });

    expect(result.ok).toBe(true);
  });

  it("returns the standard unauthorized response shape", async () => {
    const response = unauthorizedCliResponse();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
