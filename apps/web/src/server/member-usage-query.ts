import {
  memberUsageRangeSchema,
  periodSchema,
  providerSchema,
  type LeaderboardPeriod,
  type MemberUsageDetail,
  type MemberUsageRange,
} from "@token-burn/shared";

export type MemberUsageRequestPeriod = LeaderboardPeriod | MemberUsageRange;

export type MemberUsageModelFilter = {
  provider: MemberUsageDetail["models"][number]["provider"];
  modelName: string;
};

export type MemberUsageFilters = {
  providers: MemberUsageDetail["providers"][number]["provider"][];
  models: MemberUsageModelFilter[];
  devices: string[];
};

export type MemberUsageQuery = {
  period: MemberUsageRequestPeriod;
  filters: MemberUsageFilters;
};

export class MemberUsageQueryError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "MemberUsageQueryError";
  }
}

export const emptyMemberUsageFilters: MemberUsageFilters = {
  providers: [],
  models: [],
  devices: [],
};

export function parseMemberUsageQuery(searchParams: URLSearchParams): MemberUsageQuery {
  const rangeParam = searchParams.get("range");
  const parsedRange = rangeParam ? memberUsageRangeSchema.safeParse(rangeParam) : null;

  if (parsedRange && !parsedRange.success) {
    throw new MemberUsageQueryError("Invalid usage range");
  }

  const providerFilters: MemberUsageFilters["providers"] = [];
  for (const providerParam of searchParams.getAll("provider")) {
    const parsedProvider = providerSchema.safeParse(providerParam.trim());
    if (!parsedProvider.success) {
      throw new MemberUsageQueryError("Invalid provider filter");
    }
    providerFilters.push(parsedProvider.data);
  }

  const modelFilters: MemberUsageFilters["models"] = [];
  for (const modelParam of searchParams.getAll("model")) {
    const separatorIndex = modelParam.indexOf(":");
    if (separatorIndex <= 0) {
      throw new MemberUsageQueryError("Invalid model filter");
    }

    const providerPart = modelParam.slice(0, separatorIndex).trim();
    const modelName = modelParam.slice(separatorIndex + 1).trim();
    const parsedProvider = providerSchema.safeParse(providerPart);
    if (!parsedProvider.success || modelName.length === 0) {
      throw new MemberUsageQueryError("Invalid model filter");
    }

    modelFilters.push({ provider: parsedProvider.data, modelName });
  }

  if (providerFilters.length > 0 && modelFilters.length > 0) {
    throw new MemberUsageQueryError("Provider and model filters cannot be combined");
  }

  const deviceFilters: MemberUsageFilters["devices"] = [];
  for (const deviceParam of searchParams.getAll("device")) {
    const device = deviceParam.trim();
    if (device.length === 0) {
      throw new MemberUsageQueryError("Invalid device filter");
    }
    deviceFilters.push(device);
  }

  const period =
    parsedRange?.data ??
    periodSchema.catch("daily").parse(searchParams.get("period") ?? undefined);

  return {
    period,
    filters: {
      providers: providerFilters,
      models: modelFilters,
      devices: deviceFilters,
    },
  };
}
