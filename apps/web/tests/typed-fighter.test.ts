import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { typedFighterId, typedStake } from "../typed-fighter.ts";

describe("typedFighterId", () => {
  const selectable = [2, 4, 6];

  it("reads a 1-based two-digit number that the server marked selectable", () => {
    assert.equal(typedFighterId("03", selectable), 2);
    assert.equal(typedFighterId("07", selectable), 6);
  });

  it("refuses a short buffer, a non-digit, and an id that is not selectable", () => {
    assert.equal(typedFighterId("3", selectable), null);
    assert.equal(typedFighterId("0a", selectable), null);
    assert.equal(typedFighterId("01", selectable), null);
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
