import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { roomNumber, typedFighterId, typedRoomId, typedStake } from "../typed-fighter.ts";

describe("room numbers", () => {
  it("round-trips every id of a ten-resident roster through one key", () => {
    for (let id = 0; id < 10; id++) assert.equal(typedRoomId(roomNumber(id)), id);
  });

  it("books only a single digit the server marked selectable", () => {
    assert.equal(typedFighterId(roomNumber(4), [2, 4, 6]), 4);
    assert.equal(typedFighterId(roomNumber(3), [2, 4, 6]), null);
    assert.equal(typedFighterId("", [2, 4, 6]), null);
    assert.equal(typedFighterId("a", [2, 4, 6]), null);
  });
});

describe("typedStake", () => {
  it("reads a positive whole-dollar amount from the keypad", () => {
    assert.equal(typedStake("5"), 5);
    assert.equal(typedStake("05"), 5);
    assert.equal(typedStake("12"), 12);
  });

  it("refuses an empty buffer, zero, and a non-digit", () => {
    assert.equal(typedStake(""), null);
    assert.equal(typedStake("0"), null);
    assert.equal(typedStake("00"), null);
    assert.equal(typedStake("1a"), null);
  });
});
