import { describe, expect, it } from "vitest";

import { isAdminGithubLogin, isAdminSessionUser } from "./admin";

describe("isAdminGithubLogin", () => {
  it("returns true only for the configured admin login", () => {
    expect(isAdminGithubLogin("blnayan", "blnayan")).toBe(true);
    expect(isAdminGithubLogin("someone-else", "blnayan")).toBe(false);
  });

  it("returns false for missing logins", () => {
    expect(isAdminGithubLogin(undefined, "blnayan")).toBe(false);
    expect(isAdminGithubLogin(null, "blnayan")).toBe(false);
    expect(isAdminGithubLogin("", "blnayan")).toBe(false);
  });
});

describe("isAdminSessionUser", () => {
  it("checks a session user githubLogin", () => {
    expect(isAdminSessionUser({ githubLogin: "blnayan" }, "blnayan")).toBe(true);
    expect(isAdminSessionUser({ githubLogin: "someone-else" }, "blnayan")).toBe(false);
  });

  it("returns false when the session user is missing", () => {
    expect(isAdminSessionUser(undefined, "blnayan")).toBe(false);
    expect(isAdminSessionUser(null, "blnayan")).toBe(false);
  });
});
