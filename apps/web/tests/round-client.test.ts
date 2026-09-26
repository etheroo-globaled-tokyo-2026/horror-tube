import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServerRoundState } from "../round-client.ts";

describe("RoundState client contract", () => {
  it("accepts countdown phase and slots 1|2 from the server", () => {
    const state: ServerRoundState = {
      round: 2,
      phase: "countdown",
      endsAt: Date.now() + 15_000,
      champion: 0,
      slots: 1,
      voters: 2,
      quorum: 2,
      votes: { 1: 2, 2: 1 },
      fighters: null,
      pool: [0, 0],
      winner: null,
      videoUrl: null,
      error: null,
      chars: [
        { id: 0, alive: true, kills: 1, damage: 10 },
        { id: 1, alive: true, kills: 0, damage: 0 },
      ],
    };
    assert.equal(state.phase, "countdown");
    assert.equal(state.slots, 1);
    assert.equal(state.champion, 0);
    assert.equal(state.videoUrl, null);
  });
});
