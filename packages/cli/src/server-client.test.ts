import { describe, expect, it, vi } from "vitest";

import { HttpError, createTokenBurnServerClient, getJson, postJson } from "./server-client.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("TokenBurnServerClient", () => {
  it("normalizes base URLs and reads health", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ requiredCliVersion: "0.1.0", serverTime: "2026-06-25T00:00:00.000Z" }),
    );
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test///", fetch: fetchMock });

    await expect(client.readHealth()).resolves.toEqual({
      requiredCliVersion: "0.1.0",
      serverTime: "2026-06-25T00:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/health", {
      method: "GET",
      headers: {},
    });
  });

  it("sends bearer auth for protected endpoints", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        serverTime: "2026-06-25T00:00:00.000Z",
        until: "2026-06-25",
        providers: [{ provider: "codex", since: "2026-06-24" }],
      }),
    );
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await client.readSyncWindows({ token: "secret", deviceId: "device-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://token-burn.test/api/cli/sync-windows?deviceId=device-1",
      {
        method: "GET",
        headers: { authorization: "Bearer secret" },
      },
    );
  });

  it("preserves server error messages", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "Unauthorized" }, { status: 401 }));
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await expect(client.validateAuth({ token: "bad" })).rejects.toMatchObject({
      name: "HttpError",
      status: 401,
      message: "Unauthorized",
    });
  });

  it("rejects malformed JSON and malformed endpoint responses", async () => {
    const badJsonFetch = vi.fn(async () => new Response("not-json", { status: 200 }));
    await expect(getJson("https://token-burn.test/api", undefined, badJsonFetch)).rejects.toThrow(
      "Expected JSON response.",
    );

    const badShapeFetch = vi.fn(async () => jsonResponse({ requiredCliVersion: 1, serverTime: null }));
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: badShapeFetch });
    await expect(client.readHealth()).rejects.toThrow();
  });

  it("posts JSON bodies", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true }));

    await expect(postJson("https://token-burn.test/api/sync", { ok: true }, "token", fetchMock)).resolves.toEqual({
      accepted: true,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer token",
      },
      body: JSON.stringify({ ok: true }),
    });
  });
});
