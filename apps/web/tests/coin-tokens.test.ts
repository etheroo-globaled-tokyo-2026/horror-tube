import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COINS, coinTotal, tokensFor } from "../coin-tokens.ts";

describe("tokensFor", () => {
  it("pays out the whole-token part of the credit with the fewest tokens", () => {
    for (const dollars of [0, 0.99, 4.99, 16, 35.5, 70]) {
      const tokens = tokensFor(dollars, 99);
      const whole = dollars - (dollars % Math.min(...COINS));
      assert.equal(coinTotal(tokens), whole);
      assert.deepEqual(
        tokens,
        [...tokens].sort((a, b) => b - a),
      );
    }
    assert.deepEqual(tokensFor(36, 99), [10, 10, 10, 5, 1]);
  });

  it("stops at the cap with the largest tokens", () => {
    assert.deepEqual(tokensFor(100, 3), [10, 10, 10]);
  });
});
