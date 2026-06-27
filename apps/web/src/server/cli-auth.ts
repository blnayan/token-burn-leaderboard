import crypto from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { prisma as prismaClient } from "@/lib/prisma";

export type CliAuthPrisma = {
  cliToken: {
    findFirst(args: unknown): Promise<unknown>;
  };
};

export type CliAuthSelection = {
  cliToken?: {
    id?: true;
    tokenHash?: true;
  };
  member?: {
    id?: true;
    displayName?: true;
    username?: true;
  };
};

type SelectedCliToken<Selection extends CliAuthSelection> = Selection["cliToken"] extends object
  ? { [Key in keyof Selection["cliToken"] & string]: string }
  : object;

type SelectedMember<Selection extends CliAuthSelection> = Selection["member"] extends object
  ? { [Key in keyof Selection["member"] & string]: Key extends "username" ? string | null : string }
  : object;

export type AuthenticatedCliContext<Selection extends CliAuthSelection> = {
  token: string;
  tokenHash: string;
  cliToken: SelectedCliToken<Selection>;
  member: SelectedMember<Selection>;
};

export type CliAuthResult<Selection extends CliAuthSelection> =
  | { ok: true; context: AuthenticatedCliContext<Selection> }
  | { ok: false; response: NextResponse<{ error: string }> };

export async function authenticateCliRequest<Selection extends CliAuthSelection>(
  request: NextRequest,
  {
    prisma = prismaClient as unknown as CliAuthPrisma,
    select,
    now = () => new Date(),
  }: {
    prisma?: CliAuthPrisma;
    select: Selection;
    now?: () => Date;
  },
): Promise<CliAuthResult<Selection>> {
  const token = readBearerToken(request);
  if (!token) return { ok: false, response: unauthorizedCliResponse() };

  const tokenHash = hashSecret(token);
  const record = await prisma.cliToken.findFirst({
    where: {
      tokenHash,
      revokedAt: null,
      expiresAt: { gt: now() },
    },
    select: buildCliTokenSelect(select),
  });

  if (!record) return { ok: false, response: unauthorizedCliResponse() };

  const context = buildAuthenticatedContext(record, { token, tokenHash }) as AuthenticatedCliContext<Selection>;
  return { ok: true, context };
}

export function unauthorizedCliResponse(): NextResponse<{ error: string }> {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function createCliLoginCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let raw = "";
  for (let index = 0; index < 8; index += 1) {
    raw += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createCliLoginExpiration(now = new Date()): Date {
  return new Date(now.getTime() + 10 * 60 * 1000);
}

export function createCliToken(): string {
  return `tb_${crypto.randomBytes(32).toString("base64url")}`;
}

export function createCliTokenExpiration(now = new Date()): Date {
  return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
}

export function isCliLoginExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function buildCliTokenSelect(selection: CliAuthSelection): Record<string, unknown> {
  return {
    ...(selection.cliToken ?? {}),
    ...(selection.member ? { member: { select: selection.member } } : {}),
  };
}

function buildAuthenticatedContext(record: unknown, metadata: { token: string; tokenHash: string }) {
  const value = record as { member?: unknown };
  const { member, ...cliToken } = value;

  return {
    token: metadata.token,
    tokenHash: metadata.tokenHash,
    cliToken,
    member: member ?? {},
  };
}
