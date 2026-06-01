import { describe, expect, it } from "vitest";
import { hashInviteCode, isInviteExpired } from "./invites";

describe("hashInviteCode", () => {
  it("hashes invite codes deterministically without storing raw codes", () => {
    expect(hashInviteCode("abc")).toBe(hashInviteCode("abc"));
    expect(hashInviteCode("abc")).not.toBe("abc");
  });
});

describe("isInviteExpired", () => {
  it("treats expiration as exclusive", () => {
    expect(isInviteExpired(new Date("2026-05-31T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toBe(true);
    expect(isInviteExpired(new Date("2026-05-31T00:00:01.000Z"), new Date("2026-05-31T00:00:00.000Z"))).toBe(false);
  });
});
