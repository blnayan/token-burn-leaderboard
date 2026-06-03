import { describe, expect, it } from "vitest";

import { requiredCliVersion } from "@/server/cli-version";

import { GET } from "./route";

describe("GET /api/cli/health", () => {
  it("returns the required CLI version contract", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      requiredCliVersion,
      serverTime: expect.any(String),
    });
  });
});
