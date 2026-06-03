import { prisma as prismaClient } from "@/lib/prisma";

type UsageRow = {
  id: string;
  provider: string;
  date: Date | string;
  totalTokens: bigint;
};

export type DeviceSummary = {
  id: string;
  name: string;
  os: string;
  firstSeenAt: string;
  lastSeenAt: string;
  dailyRows: number;
  totalTokens: string;
};

type DeviceWithUsage = DeviceSummary & {
  usageRows: UsageRow[];
};

export type DuplicateDeviceGroup = {
  name: string;
  os: string;
  duplicateRows: number;
  conflictRows: number;
  devices: DeviceSummary[];
};

export type DeviceListResult = {
  devices: DeviceSummary[];
  duplicateGroups: DuplicateDeviceGroup[];
};

export type MergeConflict = {
  provider: string;
  date: string;
  sourceTotalTokens: string;
  targetTotalTokens: string;
};

export type DeviceMergeResult = {
  sourceDeviceId: string;
  targetDeviceId: string;
  deletedDuplicateRows: number;
  movedRows: number;
  deletedSourceDevice: boolean;
};

type DeviceRecord = {
  id: string;
  name: string;
  os: string;
  createdAt?: Date;
  lastSeenAt?: Date;
  usage?: UsageRow[];
};

type DeviceMergePrisma = {
  $transaction?<T>(callback: (tx: DeviceMergeTransaction) => Promise<T>): Promise<T>;
  device: {
    findMany(args: unknown): Promise<Array<{ id: string; memberId?: string; name: string; os: string }>>;
    delete?(args: unknown): Promise<unknown>;
  };
  dailyProviderUsage: {
    findMany(args: { where: { deviceId: string }; select?: unknown }): Promise<UsageRow[]>;
    deleteMany?(args: unknown): Promise<{ count: number }>;
    updateMany?(args: unknown): Promise<{ count: number }>;
  };
  dailyModelUsage?: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

type DeviceMergeTransaction = Required<Pick<DeviceMergePrisma, "device" | "dailyProviderUsage">> &
  Pick<DeviceMergePrisma, "dailyModelUsage">;

type DeviceListPrisma = {
  device: {
    findMany(args: unknown): Promise<DeviceRecord[]>;
  };
};

export async function listMemberDevices({
  prisma = prismaClient as unknown as DeviceListPrisma,
  memberId,
}: {
  prisma?: DeviceListPrisma;
  memberId: string;
}): Promise<DeviceListResult> {
  const devices = await prisma.device.findMany({
    where: { memberId },
    select: {
      id: true,
      name: true,
      os: true,
      createdAt: true,
      lastSeenAt: true,
      usage: {
        select: {
          id: true,
          provider: true,
          date: true,
          totalTokens: true,
        },
      },
    },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
  const devicesWithUsage = devices.map(normalizeDeviceRecord);

  return {
    devices: devicesWithUsage.map(stripUsageRows),
    duplicateGroups: buildDeviceDuplicateGroups(devicesWithUsage),
  };
}

export function buildDeviceDuplicateGroups(devices: DeviceWithUsage[]): DuplicateDeviceGroup[] {
  const groupsByNameAndOs = new Map<string, DeviceWithUsage[]>();

  for (const device of devices) {
    const key = `${device.name}\0${device.os}`;
    groupsByNameAndOs.set(key, [...(groupsByNameAndOs.get(key) ?? []), device]);
  }

  return [...groupsByNameAndOs.values()].flatMap((group) => {
    if (group.length < 2) return [];

    let duplicateRows = 0;
    let conflictRows = 0;

    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const plan = planDeviceUsageMerge({
          sourceRows: group[leftIndex]?.usageRows ?? [],
          targetRows: group[rightIndex]?.usageRows ?? [],
        });
        duplicateRows += plan.duplicateSourceRowIds.length;
        conflictRows += plan.conflicts.length;
      }
    }

    if (duplicateRows === 0 && conflictRows === 0) return [];

    const first = group[0];
    if (!first) return [];

    return [
      {
        name: first.name,
        os: first.os,
        duplicateRows,
        conflictRows,
        devices: group.map(stripUsageRows),
      },
    ];
  });
}

export function planDeviceUsageMerge({
  sourceRows,
  targetRows,
}: {
  sourceRows: UsageRow[];
  targetRows: UsageRow[];
}): {
  duplicateSourceRowIds: string[];
  movableSourceRowIds: string[];
  conflicts: MergeConflict[];
} {
  const targetRowsByDate = new Map(targetRows.map((row) => [usageDateKey(row), row]));
  const duplicateSourceRowIds: string[] = [];
  const movableSourceRowIds: string[] = [];
  const conflicts: MergeConflict[] = [];

  for (const sourceRow of sourceRows) {
    const targetRow = targetRowsByDate.get(usageDateKey(sourceRow));

    if (!targetRow) {
      movableSourceRowIds.push(sourceRow.id);
      continue;
    }

    if (targetRow.totalTokens === sourceRow.totalTokens) {
      duplicateSourceRowIds.push(sourceRow.id);
      continue;
    }

    conflicts.push({
      provider: sourceRow.provider,
      date: dateKey(sourceRow.date),
      sourceTotalTokens: sourceRow.totalTokens.toString(),
      targetTotalTokens: targetRow.totalTokens.toString(),
    });
  }

  return { duplicateSourceRowIds, movableSourceRowIds, conflicts };
}

export async function mergeMemberDevices({
  prisma = prismaClient as unknown as DeviceMergePrisma,
  memberId,
  sourceDeviceId,
  targetDeviceId,
}: {
  prisma?: DeviceMergePrisma;
  memberId: string;
  sourceDeviceId: string;
  targetDeviceId: string;
}): Promise<DeviceMergeResult> {
  if (sourceDeviceId === targetDeviceId) {
    throw new DeviceMergeError("Source and target devices must be different.");
  }

  const devices = await prisma.device.findMany({
    where: { memberId, id: { in: [sourceDeviceId, targetDeviceId] } },
    select: { id: true, memberId: true, name: true, os: true },
  });

  if (devices.length !== 2) {
    throw new DeviceMergeError("Both devices must exist for the authenticated member.");
  }

  const sourceRows = await prisma.dailyProviderUsage.findMany({
    where: { deviceId: sourceDeviceId },
    select: { id: true, provider: true, date: true, totalTokens: true },
  });
  const targetRows = await prisma.dailyProviderUsage.findMany({
    where: { deviceId: targetDeviceId },
    select: { id: true, provider: true, date: true, totalTokens: true },
  });
  const plan = planDeviceUsageMerge({ sourceRows, targetRows });

  if (plan.conflicts.length > 0) {
    throw new DeviceMergeConflictError(plan.conflicts);
  }

  const runMerge = async (tx: DeviceMergeTransaction): Promise<DeviceMergeResult> => {
    let deletedDuplicateRows = 0;
    let movedRows = 0;

    if (plan.duplicateSourceRowIds.length > 0) {
      const result = await tx.dailyProviderUsage.deleteMany?.({
        where: { id: { in: plan.duplicateSourceRowIds } },
      });
      deletedDuplicateRows = result?.count ?? plan.duplicateSourceRowIds.length;
    }

    if (plan.movableSourceRowIds.length > 0) {
      await tx.dailyModelUsage?.updateMany({
        where: { dailyProviderUsageId: { in: plan.movableSourceRowIds } },
        data: { deviceId: targetDeviceId },
      });
      const result = await tx.dailyProviderUsage.updateMany?.({
        where: { id: { in: plan.movableSourceRowIds } },
        data: { deviceId: targetDeviceId },
      });
      movedRows = result?.count ?? plan.movableSourceRowIds.length;
    }

    await tx.device.delete?.({ where: { id: sourceDeviceId } });

    return {
      sourceDeviceId,
      targetDeviceId,
      deletedDuplicateRows,
      movedRows,
      deletedSourceDevice: true,
    };
  };

  return prisma.$transaction ? prisma.$transaction(runMerge) : runMerge(prisma);
}

export class DeviceMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceMergeError";
  }
}

export class DeviceMergeConflictError extends Error {
  constructor(readonly conflicts: MergeConflict[]) {
    super("Cannot merge devices with conflicting usage rows.");
    this.name = "DeviceMergeConflictError";
  }
}

function normalizeDeviceRecord(device: DeviceRecord): DeviceWithUsage {
  const usageRows = device.usage ?? [];

  return {
    id: device.id,
    name: device.name,
    os: device.os,
    firstSeenAt: (device.createdAt ?? new Date(0)).toISOString(),
    lastSeenAt: (device.lastSeenAt ?? new Date(0)).toISOString(),
    dailyRows: usageRows.length,
    totalTokens: usageRows.reduce((sum, row) => sum + row.totalTokens, 0n).toString(),
    usageRows,
  };
}

function stripUsageRows(device: DeviceWithUsage): DeviceSummary {
  return {
    id: device.id,
    name: device.name,
    os: device.os,
    firstSeenAt: device.firstSeenAt,
    lastSeenAt: device.lastSeenAt,
    dailyRows: device.dailyRows,
    totalTokens: device.totalTokens,
  };
}

function usageDateKey(row: UsageRow): string {
  return `${row.provider}\0${dateKey(row.date)}`;
}

function dateKey(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
