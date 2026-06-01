import crypto from "node:crypto";

export function createCliLoginCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  for (let index = 0; index < 8; index += 1) {
    raw += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createCliLoginExpiration(now = new Date()): Date {
  return new Date(now.getTime() + 10 * 60 * 1000);
}

export function createCliToken(): string {
  return `tb_${crypto.randomBytes(32).toString("base64url")}`;
}

export function createCliTokenExpiration(now = new Date()): Date {
  return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
}

export function isCliLoginExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
