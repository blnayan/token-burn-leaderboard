import crypto from "node:crypto";

const MAX_DISPLAY_NAME_LENGTH = 32;
const DEFAULT_DISPLAY_NAME_PREFIX = "member-";

export function createDefaultDisplayName(userId: string): string {
  const value = `${DEFAULT_DISPLAY_NAME_PREFIX}${userId}`;
  if (value.length <= MAX_DISPLAY_NAME_LENGTH) return value;

  const suffix = crypto.createHash("sha256").update(userId).digest("hex").slice(0, 24);
  return `${DEFAULT_DISPLAY_NAME_PREFIX}${suffix}`;
}

export function normalizeDisplayName(input: string): string {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length === 0) throw new Error("Display name is required");
  if (value.length > MAX_DISPLAY_NAME_LENGTH) throw new Error("Display name must be 32 characters or fewer");
  return value;
}
