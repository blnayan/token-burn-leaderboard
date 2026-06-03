type SessionUserWithGithubLogin = {
  githubLogin?: string | null;
};

export function isAdminGithubLogin(githubLogin: string | null | undefined, adminGithubLogin: string): boolean {
  return Boolean(githubLogin) && githubLogin === adminGithubLogin;
}

export function isAdminSessionUser(
  user: SessionUserWithGithubLogin | null | undefined,
  adminGithubLogin: string,
): boolean {
  return isAdminGithubLogin(user?.githubLogin, adminGithubLogin);
}
