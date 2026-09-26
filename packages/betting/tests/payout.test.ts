import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PoolStatus, type Pool, type Ticket } from "../src/objects.js";
import { payout, poolFee } from "../src/payout.js";

function pool(status: number, totals: [bigint, bigint]): Pool {
  const base = { status, winningSide: 0n, totals, feeBps: 200n };
  return {
    id: "0x1",
    houseId: "0x2",
    battleId: "b",
    closesAtMs: 0n,
    pot: 0n,
    ...base,
    fee: poolFee(base),
  };
}
const ticket = (side: bigint, stake: bigint): Ticket => ({ id: "0x3", poolId: "0x1", side, stake });

describe("payout", () => {
  it("splits the pot among winners after the fee", () => {
    const settled = pool(PoolStatus.settled, [40_000_000n, 40_000_000n]);
    assert.equal(payout(settled, ticket(0n, 30_000_000n)), 59_400_000n);
    assert.equal(payout(settled, ticket(0n, 10_000_000n)), 19_800_000n);
    assert.equal(payout(settled, ticket(1n, 40_000_000n)), 0n);
  });
  it("refunds cancelled and one-sided pools", () => {
    assert.equal(payout(pool(PoolStatus.cancelled, [1n, 5n]), ticket(1n, 5n)), 5n);
    assert.equal(payout(pool(PoolStatus.settled, [0n, 5n]), ticket(1n, 5n)), 5n);
  });
  it("pays nothing while open", () => {
    assert.equal(payout(pool(PoolStatus.open, [5n, 5n]), ticket(0n, 5n)), 0n);
  });
});
