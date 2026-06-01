import { afterEach, describe, expect, it, vi } from "vitest";

import { postJson } from "./http.js";

describe("postJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses API error messages from JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "pollToken is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(postJson("https://token-burn.test/api", {})).rejects.toThrow("pollToken is required");
  });

  it("reports HTTP status and body for non-JSON error responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Service unavailable", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "text/plain" },
      }),
    );

    await expect(postJson("https://token-burn.test/api", {})).rejects.toThrow(
      "HTTP 503 Service Unavailable: Service unavailable",
    );
  });
});
