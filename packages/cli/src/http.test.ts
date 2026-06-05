import { afterEach, describe, expect, it, vi } from "vitest";

import { getJson, postJson } from "./http.js";

describe("http helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("postJson sends JSON request details and parses JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await expect(
      postJson<{ ok: boolean }>("https://token-burn.test/api/polls", { pollToken: "poll_123" }, "tb_secret"),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/polls", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer tb_secret",
      },
      body: JSON.stringify({ pollToken: "poll_123" }),
    });
  });

  it("postJson rejects malformed JSON from successful responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(postJson("https://token-burn.test/api/polls", {})).rejects.toThrow("Expected JSON response.");
  });

  it("postJson uses API error messages from JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "pollToken is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(postJson("https://token-burn.test/api", {})).rejects.toThrow("pollToken is required");
  });

  it("postJson reports HTTP status and body for non-JSON error responses", async () => {
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

  it("getJson sends bearer auth and parses JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await expect(getJson<{ ok: boolean }>("https://token-burn.test/api/cli/auth", "tb_secret")).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/auth", {
      method: "GET",
      headers: {
        authorization: "Bearer tb_secret",
      },
    });
  });

  it("getJson exposes HTTP status on failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );

    await expect(getJson("https://token-burn.test/api/cli/auth", "tb_bad")).rejects.toMatchObject({
      name: "HttpError",
      message: "Unauthorized",
      status: 401,
    });
  });
});
