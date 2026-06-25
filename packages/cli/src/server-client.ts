import { z } from "zod";

import {
  syncWindowsResponseSchema,
  type SyncPayload,
  type SyncWindowsResponse,
} from "@token-burn/shared";

type Fetch = typeof fetch;

const cliHealthSchema = z.object({
  requiredCliVersion: z.string().min(1),
  serverTime: z.string().datetime(),
});

const authValidationResponseSchema = z.object({
  authenticated: z.literal(true),
  member: z.object({
    displayName: z.string().min(1),
    username: z.string().min(1).optional(),
  }),
});

const loginStartResponseSchema = z.object({
  loginUrl: z.string().url(),
  pollToken: z.string().min(1),
  expiresAt: z.string().datetime(),
});

const loginPollResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("approved"),
    token: z.string().min(1),
    member: z.object({
      displayName: z.string().min(1),
      username: z.string().min(1).optional(),
    }),
  }),
]);

const deviceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  os: z.string().min(1),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  dailyRows: z.number().int().nonnegative(),
  totalTokens: z.string().regex(/^\d+$/),
});

const duplicateDeviceGroupSchema = z.object({
  name: z.string().min(1),
  os: z.string().min(1),
  duplicateRows: z.number().int().nonnegative(),
  conflictRows: z.number().int().nonnegative(),
  devices: z.array(deviceSummarySchema),
});

const deviceListResponseSchema = z.object({
  devices: z.array(deviceSummarySchema),
  duplicateGroups: z.array(duplicateDeviceGroupSchema),
});

const deviceMergeResponseSchema = z.object({
  sourceDeviceId: z.string().min(1),
  targetDeviceId: z.string().min(1),
  deletedDuplicateRows: z.number().int().nonnegative(),
  movedRows: z.number().int().nonnegative(),
  resolvedConflictRows: z.number().int().nonnegative(),
  deletedSourceDevice: z.boolean(),
});

const syncAcceptedResponseSchema = z.object({
  accepted: z.literal(true),
});

export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type CliHealth = z.infer<typeof cliHealthSchema>;
export type AuthValidationResponse = z.infer<typeof authValidationResponseSchema>;
export type LoginStartResponse = z.infer<typeof loginStartResponseSchema>;
export type LoginPollResponse = z.infer<typeof loginPollResponseSchema>;
export type DeviceSummary = z.infer<typeof deviceSummarySchema>;
export type DuplicateDeviceGroup = z.infer<typeof duplicateDeviceGroupSchema>;
export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>;
export type DeviceMergeResponse = z.infer<typeof deviceMergeResponseSchema>;

export type TokenBurnServerClient = {
  readHealth: () => Promise<CliHealth>;
  validateAuth: (options: { token: string }) => Promise<AuthValidationResponse>;
  readSyncWindows: (options: { token: string; deviceId: string }) => Promise<SyncWindowsResponse>;
  submitSyncPayload: (options: { token: string; payload: SyncPayload }) => Promise<{ accepted: true }>;
  startLogin: () => Promise<LoginStartResponse>;
  pollLogin: (options: { pollToken: string }) => Promise<LoginPollResponse>;
  listDevices: (options: { token: string }) => Promise<DeviceListResponse>;
  mergeDevices: (options: {
    token: string;
    sourceDeviceId: string;
    targetDeviceId: string;
  }) => Promise<DeviceMergeResponse>;
};

export function createTokenBurnServerClient({
  serverUrl,
  fetch: fetchImpl = globalThis.fetch,
}: {
  serverUrl: string;
  fetch?: Fetch;
}): TokenBurnServerClient {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);

  return {
    async readHealth() {
      return cliHealthSchema.parse(await getJson(`${normalizedServerUrl}/api/cli/health`, undefined, fetchImpl));
    },

    async validateAuth({ token }) {
      return authValidationResponseSchema.parse(
        await getJson(`${normalizedServerUrl}/api/cli/auth`, token, fetchImpl),
      );
    },

    async readSyncWindows({ token, deviceId }) {
      return syncWindowsResponseSchema.parse(
        await getJson(
          `${normalizedServerUrl}/api/cli/sync-windows?deviceId=${encodeURIComponent(deviceId)}`,
          token,
          fetchImpl,
        ),
      );
    },

    async submitSyncPayload({ token, payload }) {
      return syncAcceptedResponseSchema.parse(
        await postJson(`${normalizedServerUrl}/api/sync`, payload, token, fetchImpl),
      );
    },

    async startLogin() {
      return loginStartResponseSchema.parse(
        await postJson(`${normalizedServerUrl}/api/cli/login/start`, {}, undefined, fetchImpl),
      );
    },

    async pollLogin({ pollToken }) {
      return loginPollResponseSchema.parse(
        await postJson(`${normalizedServerUrl}/api/cli/login/poll`, { pollToken }, undefined, fetchImpl),
      );
    },

    async listDevices({ token }) {
      return deviceListResponseSchema.parse(
        await getJson(`${normalizedServerUrl}/api/cli/devices`, token, fetchImpl),
      );
    },

    async mergeDevices({ token, sourceDeviceId, targetDeviceId }) {
      return deviceMergeResponseSchema.parse(
        await postJson(
          `${normalizedServerUrl}/api/cli/devices/merge`,
          { sourceDeviceId, targetDeviceId },
          token,
          fetchImpl,
        ),
      );
    },
  };
}

export async function getJson<T>(url: string, token?: string, fetchImpl: Fetch = globalThis.fetch): Promise<T> {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  return parseJsonResponse<T>(response);
}

export async function postJson<T>(
  url: string,
  body: unknown,
  token?: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = parseJsonOrNull(text);

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : formatHttpError(response, text);
    throw new HttpError(message, response.status);
  }

  if (text && data === null) {
    throw new Error("Expected JSON response.");
  }

  return data as T;
}

function parseJsonOrNull(text: string): unknown {
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function formatHttpError(response: Response, text: string): string {
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  const body = text.trim();

  return body ? `${status}: ${body}` : status;
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}
