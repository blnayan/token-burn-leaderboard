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

  it("sends bearer auth and encodes device IDs when reading sync windows", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        serverTime: "2026-06-25T00:00:00.000Z",
        until: "2026-06-25",
        providers: [{ provider: "codex", since: "2026-06-24" }],
      }),
    );
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await client.readSyncWindows({ token: "secret", deviceId: "device 1/2?x" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://token-burn.test/api/cli/sync-windows?deviceId=device%201%2F2%3Fx",
      {
        method: "GET",
        headers: { authorization: "Bearer secret" },
      },
    );
  });

  it("submits sync payloads with bearer auth and validates accepted responses", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true }));
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });
    const payload = {
      provider: "codex",
      date: "2026-06-25",
      tokenCategories: { input: 10, output: 20 },
      totalTokens: 30,
      deviceId: "4f43b27d-7d86-4ff8-8c98-f74158819e59",
      deviceName: "Dev Machine",
      cliVersion: "0.1.0",
      ccusageVersion: "20.0.6",
      os: "darwin",
      syncedAt: "2026-06-25T00:00:00.000Z",
    };

    await expect(client.submitSyncPayload({ token: "secret", payload })).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
      },
      body: JSON.stringify(payload),
    });

    const rejectedFetchMock = vi.fn(async () => jsonResponse({ accepted: false }));
    const rejectingClient = createTokenBurnServerClient({
      serverUrl: "https://token-burn.test",
      fetch: rejectedFetchMock,
    });

    await expect(rejectingClient.submitSyncPayload({ token: "secret", payload })).rejects.toThrow();
  });

  it("starts login sessions with an empty JSON body", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        loginUrl: "https://token-burn.test/login/poll_123",
        pollToken: "poll_123",
        expiresAt: "2026-06-25T00:05:00.000Z",
      }),
    );
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await expect(client.startLogin()).resolves.toEqual({
      loginUrl: "https://token-burn.test/login/poll_123",
      pollToken: "poll_123",
      expiresAt: "2026-06-25T00:05:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/login/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("polls login sessions with the poll token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: "approved",
        token: "tb_secret",
        member: { displayName: "Token Burner", username: "token-burner" },
      }),
    );
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await expect(client.pollLogin({ pollToken: "poll_123" })).resolves.toEqual({
      status: "approved",
      token: "tb_secret",
      member: { displayName: "Token Burner", username: "token-burner" },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/login/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pollToken: "poll_123" }),
    });
  });

  it("lists devices with bearer auth", async () => {
    const response = {
      devices: [
        {
          id: "device-1",
          name: "Dev Machine",
          os: "darwin",
          firstSeenAt: "2026-06-24T00:00:00.000Z",
          lastSeenAt: "2026-06-25T00:00:00.000Z",
          dailyRows: 2,
          totalTokens: "300",
        },
      ],
      duplicateGroups: [],
    };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await expect(client.listDevices({ token: "secret" })).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/devices", {
      method: "GET",
      headers: { authorization: "Bearer secret" },
    });
  });

  it("merges devices with bearer auth and source/target body", async () => {
    const response = {
      sourceDeviceId: "device-1",
      targetDeviceId: "device-2",
      deletedDuplicateRows: 3,
      movedRows: 4,
      resolvedConflictRows: 1,
      deletedSourceDevice: true,
    };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    const client = createTokenBurnServerClient({ serverUrl: "https://token-burn.test", fetch: fetchMock });

    await expect(
      client.mergeDevices({ token: "secret", sourceDeviceId: "device-1", targetDeviceId: "device-2" }),
    ).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("https://token-burn.test/api/cli/devices/merge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
      },
      body: JSON.stringify({ sourceDeviceId: "device-1", targetDeviceId: "device-2" }),
    });
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
