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

export function encodeMemberUsageQuery(query: MemberUsageQuery): URLSearchParams {
  const params = new URLSearchParams();

  if (isMemberUsageRange(query.period)) {
    params.set("range", query.period);
  } else {
    params.set("period", query.period);
  }

  for (const provider of query.filters.providers) {
    params.append("provider", provider);
  }

  for (const model of query.filters.models) {
    params.append("model", encodeMemberUsageModelFilter(model));
  }

  for (const device of query.filters.devices) {
    params.append("device", device);
  }

  return params;
}

export function encodeMemberUsageModelFilter(model: MemberUsageModelFilter): string {
  return `${model.provider}:${model.modelName}`;
}

export function isSameMemberUsageModelFilter(
  left: MemberUsageModelFilter,
  right: MemberUsageModelFilter,
): boolean {
  return left.provider === right.provider && left.modelName === right.modelName;
}

export function hasMemberUsageFilters(filters: MemberUsageFilters): boolean {
  return filters.providers.length > 0 || filters.models.length > 0 || filters.devices.length > 0;
}

export function toggleMemberUsageProviderFilter(
  filters: MemberUsageFilters,
  provider: MemberUsageFilters["providers"][number],
): MemberUsageFilters {
  const selected = filters.providers.includes(provider);

  return {
    providers: selected
      ? filters.providers.filter((selectedProvider) => selectedProvider !== provider)
      : [...filters.providers, provider],
    models: [],
    devices: [...filters.devices],
  };
}

export function toggleMemberUsageModelFilter(
  filters: MemberUsageFilters,
  model: MemberUsageModelFilter,
): MemberUsageFilters {
  const selected = filters.models.some((selectedModel) =>
    isSameMemberUsageModelFilter(selectedModel, model),
  );

  return {
    providers: [],
    models: selected
      ? filters.models.filter((selectedModel) => !isSameMemberUsageModelFilter(selectedModel, model))
      : [...filters.models, model],
    devices: [...filters.devices],
  };
}

export function toggleMemberUsageDeviceFilter(
  filters: MemberUsageFilters,
  deviceId: string,
): MemberUsageFilters {
  const selected = filters.devices.includes(deviceId);

  return {
    providers: [...filters.providers],
    models: [...filters.models],
    devices: selected
      ? filters.devices.filter((selectedDeviceId) => selectedDeviceId !== deviceId)
      : [...filters.devices, deviceId],
  };
}

function isMemberUsageRange(period: MemberUsageRequestPeriod): period is MemberUsageRange {
  return period === "7d" || period === "30d";
}

function parseMemberUsageModelFilter(modelParam: string): MemberUsageModelFilter {
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

  return { provider: parsedProvider.data, modelName };
}

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

  const modelFilters = searchParams
    .getAll("model")
    .map((modelParam) => parseMemberUsageModelFilter(modelParam));

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
