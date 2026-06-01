import { describe, expect, it } from "vitest";
import { rankRows } from "./leaderboard";

describe("rankRows", () => {
  it("sorts by total tokens descending and assigns ranks", () => {
    expect(
      rankRows([
        { displayName: "Ada", totalTokens: 100n },
        { displayName: "Linus", totalTokens: 300n },
        { displayName: "Grace", totalTokens: 200n },
      ]),
    ).toEqual([
      { rank: 1, displayName: "Linus", totalTokens: 300 },
      { rank: 2, displayName: "Grace", totalTokens: 200 },
      { rank: 3, displayName: "Ada", totalTokens: 100 },
    ]);
  });
});
