import { describe, expect, it } from "vitest";

import {
  encodeMemberUsageModelFilter,
  encodeMemberUsageQuery,
  hasMemberUsageFilters,
  isSameMemberUsageModelFilter,
  MemberUsageQueryError,
  parseMemberUsageQuery,
  toggleMemberUsageDeviceFilter,
  toggleMemberUsageModelFilter,
  toggleMemberUsageProviderFilter,
} from "./member-usage-query";

describe("parseMemberUsageQuery", () => {
  it("defaults to daily period with empty filters", () => {
    expect(parseMemberUsageQuery(new URLSearchParams())).toEqual({
      period: "daily",
      filters: {
        providers: [],
        models: [],
        devices: [],
      },
    });
  });

  it("defaults invalid periods to daily with empty filters", () => {
    expect(parseMemberUsageQuery(new URLSearchParams([["period", "nope"]]))).toEqual({
      period: "daily",
      filters: {
        providers: [],
        models: [],
        devices: [],
      },
    });
  });

  it("parses range, provider, model, and device params", () => {
    const providerQuery = parseMemberUsageQuery(
      new URLSearchParams([
        ["range", "7d"],
        ["provider", "codex"],
        ["provider", "claude_code"],
        ["provider", "opencode"],
        ["provider", "grok"],
        ["device", "device-1"],
        ["device", "device-2"],
      ]),
    );

    expect(providerQuery).toEqual({
      period: "7d",
      filters: {
        providers: ["codex", "claude_code", "opencode", "grok"],
        models: [],
        devices: ["device-1", "device-2"],
      },
    });

    const modelQuery = parseMemberUsageQuery(
      new URLSearchParams([
        ["range", "30d"],
        ["model", "codex:gpt-5.4"],
        ["model", "grok:grok-code-fast-1"],
        ["model", "gemini:gemini-2.5-pro"],
        ["model", "claude_code:opus"],
      ]),
    );

    expect(modelQuery).toEqual({
      period: "30d",
      filters: {
        providers: [],
        models: [
          { provider: "codex", modelName: "gpt-5.4" },
          { provider: "grok", modelName: "grok-code-fast-1" },
          { provider: "gemini", modelName: "gemini-2.5-pro" },
          { provider: "claude_code", modelName: "opus" },
        ],
        devices: [],
      },
    });
  });

  it("splits model filters on the first colon only", () => {
    expect(parseMemberUsageQuery(new URLSearchParams([["model", "codex:model:with:colon"]]))).toEqual({
      period: "daily",
      filters: {
        providers: [],
        models: [{ provider: "codex", modelName: "model:with:colon" }],
        devices: [],
      },
    });
  });

  it("rejects invalid inputs with stable response messages", () => {
    expect(() => parseMemberUsageQuery(new URLSearchParams([["range", "bad"]]))).toThrow(
      new MemberUsageQueryError("Invalid usage range"),
    );
    expect(() => parseMemberUsageQuery(new URLSearchParams([["provider", "bad"]]))).toThrow(
      new MemberUsageQueryError("Invalid provider filter"),
    );
    expect(() => parseMemberUsageQuery(new URLSearchParams([["model", "codex"]]))).toThrow(
      new MemberUsageQueryError("Invalid model filter"),
    );
    expect(() => parseMemberUsageQuery(new URLSearchParams([["device", "  "]]))).toThrow(
      new MemberUsageQueryError("Invalid device filter"),
    );
    expect(() =>
      parseMemberUsageQuery(
        new URLSearchParams([
          ["provider", "codex"],
          ["model", "codex:gpt-5.4"],
        ]),
      ),
    ).toThrow(new MemberUsageQueryError("Provider and model filters cannot be combined"));
  });
});

describe("encodeMemberUsageQuery", () => {
  it("encodes ranges, providers, models, and devices with the route grammar", () => {
    const providerParams = encodeMemberUsageQuery({
      period: "7d",
      filters: {
        providers: ["codex", "claude_code", "opencode", "grok"],
        models: [],
        devices: ["device-1", "device-2"],
      },
    });

    expect(providerParams.toString()).toBe(
      "range=7d&provider=codex&provider=claude_code&provider=opencode&provider=grok&device=device-1&device=device-2",
    );

    const modelParams = encodeMemberUsageQuery({
      period: "30d",
      filters: {
        providers: [],
        models: [
          { provider: "codex", modelName: "gpt-5" },
          { provider: "grok", modelName: "grok-code-fast-1" },
          { provider: "claude_code", modelName: "opus:sonnet" },
        ],
        devices: ["device-2"],
      },
    });

    expect(modelParams.toString()).toBe(
      "range=30d&model=codex%3Agpt-5&model=grok%3Agrok-code-fast-1&model=claude_code%3Aopus%3Asonnet&device=device-2",
    );
  });

  it("encodes non-range periods with the period param", () => {
    expect(
      encodeMemberUsageQuery({
        period: "weekly",
        filters: { providers: [], models: [], devices: [] },
      }).toString(),
    ).toBe("period=weekly");
  });

  it("uses the same model key grammar for encoding and parsing", () => {
    const key = encodeMemberUsageModelFilter({
      provider: "codex",
      modelName: "model:with:colon",
    });

    expect(key).toBe("codex:model:with:colon");
    expect(parseMemberUsageQuery(new URLSearchParams([["model", key]]))).toEqual({
      period: "daily",
      filters: {
        providers: [],
        models: [{ provider: "codex", modelName: "model:with:colon" }],
        devices: [],
      },
    });
  });
});

describe("member usage filter helpers", () => {
  it("toggles provider, model, and device filters using one invariant set", () => {
    const withModel = toggleMemberUsageModelFilter(
      { providers: ["codex"], models: [], devices: ["device-1"] },
      { provider: "claude_code", modelName: "opus" },
    );

    expect(withModel).toEqual({
      providers: [],
      models: [{ provider: "claude_code", modelName: "opus" }],
      devices: ["device-1"],
    });

    const withoutModel = toggleMemberUsageModelFilter(withModel, {
      provider: "claude_code",
      modelName: "opus",
    });
    expect(withoutModel).toEqual({
      providers: [],
      models: [],
      devices: ["device-1"],
    });

    const withProvider = toggleMemberUsageProviderFilter(
      {
        providers: [],
        models: [{ provider: "claude_code", modelName: "opus" }],
        devices: ["device-1"],
      },
      "codex",
    );
    expect(withProvider).toEqual({
      providers: ["codex"],
      models: [],
      devices: ["device-1"],
    });

    const withSecondDevice = toggleMemberUsageDeviceFilter(withProvider, "device-2");
    expect(withSecondDevice).toEqual({
      providers: ["codex"],
      models: [],
      devices: ["device-1", "device-2"],
    });

    expect(toggleMemberUsageDeviceFilter(withSecondDevice, "device-1")).toEqual({
      providers: ["codex"],
      models: [],
      devices: ["device-2"],
    });
  });

  it("detects active filters and compares model filters", () => {
    expect(hasMemberUsageFilters({ providers: [], models: [], devices: [] })).toBe(false);
    expect(hasMemberUsageFilters({ providers: [], models: [], devices: ["device-1"] })).toBe(true);
    expect(
      isSameMemberUsageModelFilter(
        { provider: "codex", modelName: "gpt-5" },
        { provider: "codex", modelName: "gpt-5" },
      ),
    ).toBe(true);
    expect(
      isSameMemberUsageModelFilter(
        { provider: "codex", modelName: "gpt-5" },
        { provider: "codex", modelName: "gpt-4" },
      ),
    ).toBe(false);
  });
});
