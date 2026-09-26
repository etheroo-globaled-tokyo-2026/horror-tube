import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOSES_AT_UNSET, placeholderView, type PlaceholderInput } from "../placeholder-view.ts";

function state(overrides: Partial<PlaceholderInput>): PlaceholderInput {
  return {
    phase: "vote",
    champion: null,
    votes: {},
    tally: null,
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
  it("shows living non-champion candidates with server counts and only the stored tally", () => {
    const counting = placeholderView(
      state({ phase: "countdown", champion: 3, votes: { 0: 2, 2: 1 } }),
    );
    assert.deepEqual(counting, {
      screen: "vote",
      candidates: [
        { id: 0, name: "Jason", votes: 2 },
        { id: 2, name: "Chucky", votes: 1 },
      ],
      tally: null,
    });
    const stored = placeholderView(
      state({
        phase: "countdown",
        votes: { 0: 2, 2: 1 },
        tally: [
          { id: 2, votes: 5, reachedAt: 10 },
          { id: 0, votes: 2, reachedAt: 20 },
        ],
      }),
    );
    assert.deepEqual(stored?.tally, [
      { name: "Chucky", votes: 5 },
      { name: "Jason", votes: 2 },
    ]);
  });

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

  it("shows neither screen outside vote, countdown, and bet", () => {
    for (const phase of ["gate", "fight", "settle", "over"]) {
      assert.equal(placeholderView(state({ phase, fighters: [0, 2] })), null, phase);
    }
  });
});
