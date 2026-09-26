import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOSES_AT_UNSET, placeholderView, type PlaceholderInput } from "../placeholder-view.ts";

function state(overrides: Partial<PlaceholderInput>): PlaceholderInput {
  return {
    phase: "bet",
    fighters: null,
    selectable: [],
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

  it("lists the server's selectable fighters for the opening booking and the next fighter", () => {
    const opening = placeholderView(
      state({ phase: "waiting", selectable: [0, 2], fighters: null }),
    );
    assert.equal(opening?.screen, "pick");
    if (opening?.screen !== "pick") return;
    assert.equal(opening.title, "BOOK THE FIRST FIGHTER");
    assert.equal(opening.act, "book");
    assert.deepEqual(opening.choices, [
      { id: 0, name: "Jason" },
      { id: 2, name: "Chucky" },
    ]);
    const next = placeholderView(state({ phase: "pick", selectable: [1], fighters: null }));
    if (next?.screen !== "pick") return;
    assert.equal(next.act, "next-fighter");
    assert.deepEqual(next.choices, [{ id: 1, name: "Freddy" }]);
  });

  it("shows the bet screen only in bet", () => {
    for (const phase of ["gate", "waiting", "fight", "settle", "over"]) {
      assert.equal(placeholderView(state({ phase, fighters: [0, 2] })), null, phase);
    }
  });
});
