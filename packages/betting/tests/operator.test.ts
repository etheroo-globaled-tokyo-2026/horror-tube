import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import type { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { poolId } from "../src/ids.js";
import { PoolStatus, type Pool } from "../src/objects.js";
import { createOperator, type OperatorChain } from "../src/operator.js";

const ids = { packageId: "0x0", houseId: "0x1234", coinType: "0x2::sui::SUI" };
const battleId = "battle-1";
const closesAtMs = BigInt(Date.now() + 60_000);

function openPool(): Pool {
  return {
    id: poolId(ids, battleId),
    houseId: ids.houseId,
    battleId,
    closesAtMs,
    feeBps: 200n,
    status: PoolStatus.open,
    winningSide: 0n,
    fee: 0n,
    totals: [0n, 0n],
    pot: 0n,
  };
}

function settledPool(side: bigint): Pool {
  return { ...openPool(), status: PoolStatus.settled, winningSide: side };
}

function moveCall(tx: Transaction) {
  const { commands, inputs } = tx.getData();
  const call = commands[0]?.MoveCall;
  if (call === undefined) throw new Error("Expected a MoveCall.");
  const arg = call.function === "settle" ? call.arguments[3] : undefined;
  const input = arg?.$kind === "Input" ? inputs[arg.Input] : undefined;
  const side = input?.$kind === "Pure" ? BigInt(bcs.u64().parse(fromBase64(input.Pure.bytes))) : 0n;
  return { name: call.function, side };
}

function apply(pool: Pool | null, name: string, side: bigint): Pool {
  if (name === "open_pool") return openPool();
  if (pool === null) throw new Error(`${name} on a missing pool.`);
  if (name === "close_betting") return { ...pool, closesAtMs: BigInt(Date.now()) };
  if (name === "settle") return { ...pool, status: PoolStatus.settled, winningSide: side };
  if (name === "cancel") return { ...pool, status: PoolStatus.cancelled };
  throw new Error(`Unexpected call ${name}.`);
}

function fakeChain(start: Pool | null) {
  const calls: string[] = [];
  let pool = start;
  let failNext = false;
  const chain: OperatorChain = {
    readPool: async () => pool,
    run: async (tx) => {
      const { name, side } = moveCall(tx);
      if (failNext) {
        failNext = false;
        throw new Error(`${name} rejected.`);
      }
      calls.push(name);
      pool = apply(pool, name, side);
    },
  };
  return {
    calls,
    pool: () => pool,
    failNextRun: () => {
      failNext = true;
    },
    operator: createOperator(chain, ids, "0xcafe"),
  };
}

describe("operator", () => {
  it("opens a pool once when asked twice at the same time", async () => {
    const chain = fakeChain(null);
    await Promise.all([
      chain.operator.openPool(battleId, closesAtMs),
      chain.operator.openPool(battleId, closesAtMs),
    ]);
    assert.deepEqual(chain.calls, ["open_pool"]);
  });

  it("treats a retried close or settle as done", async () => {
    const chain = fakeChain(openPool());
    await chain.operator.closeBetting(battleId);
    await chain.operator.closeBetting(battleId);
    await chain.operator.settle(battleId, 1);
    await chain.operator.settle(battleId, 1);
    assert.deepEqual(chain.calls, ["close_betting", "settle"]);
    assert.equal(chain.pool()?.winningSide, 1n);
  });

  it("refuses to settle a settled pool for the other side", async () => {
    const chain = fakeChain(settledPool(1n));
    await assert.rejects(chain.operator.settle(battleId, 0), /cannot settle for side 0/u);
    assert.deepEqual(chain.calls, []);
  });

  it("refuses to cancel a settled pool", async () => {
    const chain = fakeChain(settledPool(0n));
    await assert.rejects(chain.operator.cancel(battleId), /cannot cancel/u);
    assert.deepEqual(chain.calls, []);
  });

  it("rejects the call whose run fails and still runs the next one", async () => {
    const chain = fakeChain(null);
    chain.failNextRun();
    await assert.rejects(chain.operator.openPool(battleId, closesAtMs), /open_pool rejected/u);
    await chain.operator.openPool(battleId, closesAtMs);
    assert.deepEqual(chain.calls, ["open_pool"]);
  });
});
