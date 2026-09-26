import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Phase, RoundState } from "../src/types.js";

describe("RoundState contract", () => {
  it("exports Phase and RoundState with the docs/game-loop.md fields", () => {
    const phases: Phase[] = [
      "vote",
      "countdown",
      "bet",
      "fight",
      "settle",
      "over",
    ];
    assert.equal(phases.length, 6);

    const state: RoundState = {
      round: 0,
      phase: "vote",
      endsAt: null,
      champion: null,
      slots: 2,
      voters: 0,
      quorum: 1,
      votes: {},
      fighters: null,
      pool: [0, 0],
      winner: null,
      videoUrl: null,
      videoStyle: null,
      frameUrl: null,
      error: null,
      chars: [],
    };

    const keys = Object.keys(state).sort();
    assert.deepEqual(keys, [
      "champion",
      "chars",
      "endsAt",
      "error",
      "fighters",
      "frameUrl",
      "phase",
      "pool",
      "quorum",
      "round",
      "slots",
      "videoStyle",
      "videoUrl",
      "voters",
      "votes",
      "winner",
    ]);
  });
});
