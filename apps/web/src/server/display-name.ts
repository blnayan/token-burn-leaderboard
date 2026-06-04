const MAX_DISPLAY_NAME_LENGTH = 80;

export function createDefaultDisplayName({
  githubName,
  githubLogin,
}: {
  githubName?: string | null;
  githubLogin: string;
}): string {
  const normalizedGithubName = normalizeOptionalDisplayName(githubName);
  if (normalizedGithubName) return normalizedGithubName;

  return githubLogin;
}

export function normalizeDisplayName(input: string): string {
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length === 0) throw new Error("Display name is required");
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error(`Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`);
  }
  return value;
}

function normalizeOptionalDisplayName(input: string | null | undefined): string | null {
  if (!input) return null;

  try {
    return normalizeDisplayName(input);
  } catch {
    return null;
  }
}
