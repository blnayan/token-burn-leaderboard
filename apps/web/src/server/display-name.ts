const MAX_DISPLAY_NAME_LENGTH = 32;

export function normalizeDisplayName(input: string): string {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length === 0) throw new Error("Display name is required");
  if (value.length > MAX_DISPLAY_NAME_LENGTH) throw new Error("Display name must be 32 characters or fewer");
  return value;
}
