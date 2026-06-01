import crypto from "node:crypto";

export function createInviteCode(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashInviteCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function isInviteExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function createInviteExpiration(now = new Date()): Date {
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}
