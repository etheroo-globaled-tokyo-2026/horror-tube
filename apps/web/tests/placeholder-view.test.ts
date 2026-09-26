import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CLOSES_AT_UNSET,
  placeholderView,
  type PlaceholderInput,
} from "../placeholder-view.ts";

const state = (over: Partial<PlaceholderInput> = {}): PlaceholderInput => ({
  phase: "bet",
  fighters: [0, 1],
  pool: [1_000_000, 2_000_000],
  bettingClosesAt: null,
  chars: [
    { id: 0, name: "Jason", alive: true },
    { id: 1, name: "Freddy", alive: true },
    { id: 2, name: "Chucky", alive: true },
  ],
  ...over,
});

describe("placeholderView", () => {
  it("shows bet sides and closesAt from RoundState", () => {
    const closesAt = Date.parse("2026-04-01T12:00:05.000Z");
    const view = placeholderView(
      state({
        phase: "bet",
        fighters: [0, 2],
        pool: [3_000_000, 500_000],
        bettingClosesAt: closesAt,
      }),
    );
    assert.deepEqual(view, {
      screen: "bet",
      sides: [
        { name: "Jason", usdc: "3.00" },
        { name: "Chucky", usdc: "0.50" },
      ],
      closesAt: new Date(closesAt).toISOString(),
    });
  });

  it("names unset closesAt while waiting for playback start", () => {
    const view = placeholderView(state({ bettingClosesAt: null }));
    assert.equal(view?.screen, "bet");
    assert.equal(view && "closesAt" in view ? view.closesAt : null, CLOSES_AT_UNSET);
  });

  it("shows nothing outside bet", () => {
    assert.equal(placeholderView(state({ phase: "fight" })), null);
    assert.equal(placeholderView(state({ phase: "over", fighters: null })), null);
  });
});
