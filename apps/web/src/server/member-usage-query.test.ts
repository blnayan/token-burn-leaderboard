import { describe, expect, it } from "vitest";

import {
  MemberUsageQueryError,
  parseMemberUsageQuery,
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

  it("parses range, provider, model, and device params", () => {
    const providerQuery = parseMemberUsageQuery(
      new URLSearchParams([
        ["range", "7d"],
        ["provider", "codex"],
        ["device", "device-1"],
        ["device", "device-2"],
      ]),
    );

    expect(providerQuery).toEqual({
      period: "7d",
      filters: {
        providers: ["codex"],
        models: [],
        devices: ["device-1", "device-2"],
      },
    });

    const modelQuery = parseMemberUsageQuery(
      new URLSearchParams([
        ["range", "30d"],
        ["model", "codex:gpt-5.4"],
      ]),
    );

    expect(modelQuery).toEqual({
      period: "30d",
      filters: {
        providers: [],
        models: [{ provider: "codex", modelName: "gpt-5.4" }],
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
