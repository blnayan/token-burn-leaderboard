export function normalizeDisplayName(input: string): string {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length === 0) throw new Error("Display name is required");
  if (value.length > 32) throw new Error("Display name must be 32 characters or fewer");
  return value;
}
