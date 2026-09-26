import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOSES_AT_UNSET, placeholderView, type PlaceholderInput } from "../placeholder-view.ts";

function state(overrides: Partial<PlaceholderInput>): PlaceholderInput {
  return {
    phase: "bet",
    fighters: null,
    pool: [0, 0],
    bettingClosesAt: null,
    chars: [
      { id: 0, name: "Jason", alive: true },
      { id: 1, name: "Freddy", alive: false },
      { id: 2, name: "Chucky", alive: true },
      { id: 3, name: "Pinhead", alive: true },
    ],
    ...overrides,
  };
}

describe("placeholderView", () => {
  it("shows the stored betting_closes_at as given, and says when it is not stored yet", () => {
    const closesAt = Date.UTC(2026, 8, 26, 12, 0, 5);
    const bet = placeholderView(
      state({
        phase: "bet",
        fighters: [2, 0],
        pool: [3_000_000, 1_500_000],
        bettingClosesAt: closesAt,
      }),
    );
    assert.equal(bet?.screen, "bet");
    assert.ok(bet?.screen === "bet");
    assert.equal(bet.closesAt, "2026-09-26T12:00:05.000Z");
    assert.deepEqual(bet.sides, [
      { name: "Chucky", usdc: "3.00" },
      { name: "Jason", usdc: "1.50" },
    ]);
    const waiting = placeholderView(state({ phase: "bet", fighters: [2, 0] }));
    assert.equal(waiting?.screen === "bet" ? waiting.closesAt : "", CLOSES_AT_UNSET);
  });

  it("shows the bet screen only in bet", () => {
    for (const phase of ["gate", "waiting", "fight", "settle", "over"]) {
      assert.equal(placeholderView(state({ phase, fighters: [0, 2] })), null, phase);
    }
  });
});
