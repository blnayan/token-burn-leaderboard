import { syncPayloadSchema } from "@token-burn/shared";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";

import { prisma } from "@/lib/prisma";
import { hashSecret } from "@/server/cli-auth";

export async function POST(request: NextRequest) {
  const token = readBearerToken(request);
  if (!token) return unauthorized();

  const cliToken = await prisma.cliToken.findFirst({
    where: {
      tokenHash: hashSecret(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      member: { select: { id: true } },
    },
  });

  if (!cliToken) return unauthorized();

  const body = await request.json().catch(() => null);

  try {
    const payload = syncPayloadSchema.parse(body);
    const date = parseUtcDate(payload.date);
    const memberId = cliToken.member.id;
    const syncedAt = new Date(payload.syncedAt);

    await prisma.$transaction(async (tx) => {
      const device = await tx.device.upsert({
        where: {
          memberId_clientDeviceId: {
            memberId,
            clientDeviceId: payload.deviceId,
          },
        },
        create: {
          memberId,
          clientDeviceId: payload.deviceId,
          name: payload.deviceName,
          os: payload.os,
          lastSeenAt: syncedAt,
        },
        update: {
          name: payload.deviceName,
          os: payload.os,
          lastSeenAt: syncedAt,
        },
        select: { id: true },
      });

      await tx.dailyProviderUsage.upsert({
        where: {
          deviceId_provider_date: {
            deviceId: device.id,
            provider: payload.provider,
            date,
          },
        },
        create: {
          memberId,
          deviceId: device.id,
          provider: payload.provider,
          date,
          tokenCategories: payload.tokenCategories,
          totalTokens: BigInt(payload.totalTokens),
          cliVersion: payload.cliVersion,
          ccusageVersion: payload.ccusageVersion,
          os: payload.os,
          syncedAt,
        },
        update: {
          tokenCategories: payload.tokenCategories,
          totalTokens: BigInt(payload.totalTokens),
          cliVersion: payload.cliVersion,
          ccusageVersion: payload.ccusageVersion,
          os: payload.os,
          syncedAt,
        },
      });

      await tx.cliToken.update({
        where: { id: cliToken.id },
        data: { lastUsedAt: new Date() },
      });
    });

    return NextResponse.json({ accepted: true });
  } catch (error) {
    if (error instanceof ZodError || error instanceof RangeError) {
      return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
    }
    throw error;
  }
}

function readBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? null;
}

function parseUtcDate(value: string): Date {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Invalid date");
  }

  return date;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
