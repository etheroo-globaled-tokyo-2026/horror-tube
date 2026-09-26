import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PoolStatus } from "@horror-tube/betting";

import type { BattleBettingPorts } from "../src/battle-betting.js";
import { MemoryPoolLedger } from "../src/db/sui-pools.js";
import {
  recordPools,
  releaseLivePool,
  sweepStrandedPools,
  type PoolChain,
} from "../src/stranded-pools.js";

type OnChain =
  | "open"
  | "settled"
  | "cancelled"
  | "missing"
  | "read fails"
  | "read hangs"
  | "cancel hangs";

const timeoutMs = 50;
const neverSettles = new Promise<never>(() => {});
const poolOf = (battleId: string): string => `0xpool-${battleId}`;

const statusOf = {
  open: PoolStatus.open,
  "cancel hangs": PoolStatus.open,
  settled: PoolStatus.settled,
  cancelled: PoolStatus.cancelled,
};

async function stranded(pools: [string, OnChain][]) {
  const ledger = new MemoryPoolLedger();
  const onChain = new Map<string, OnChain>();
  const cancelled: string[] = [];
  for (const [battleId, state] of pools) {
    await ledger.recordOpened(battleId, poolOf(battleId));
    onChain.set(poolOf(battleId), state);
  }
  const chain: PoolChain = {
    async readPool(poolId) {
      const state = onChain.get(poolId);
      if (state === undefined || state === "missing") return null;
      if (state === "read fails") throw new Error(`gRPC unavailable reading ${poolId}`);
      if (state === "read hangs") return neverSettles;
      return { status: statusOf[state] };
    },
    async cancel(battleId) {
      if (onChain.get(poolOf(battleId)) === "cancel hangs") return neverSettles;
      cancelled.push(battleId);
      onChain.set(poolOf(battleId), "cancelled");
    },
  };
  const resolution = (battleId: string) => ledger.entries.get(battleId)?.resolution ?? null;
  return { ledger, chain, cancelled, resolution };
}

function fakeBetting(calls: string[] = []): BattleBettingPorts {
  return {
    config: {
      network: "testnet",
      grpcUrl: "https://example.invalid",
      packageId: "0xpkg",
      houseId: "0xhouse",
      coinType: "0x2::sui::SUI",
    },
    poolIdFor: poolOf,
    async openBattle(battleId) {
      calls.push(`open:${battleId}`);
    },
    async cancelBattle(battleId) {
      calls.push(`cancel:${battleId}`);
    },
    async closeBetting(battleId) {
      calls.push(`close:${battleId}`);
    },
    async settle(battleId) {
      calls.push(`settle:${battleId}`);
      return `digest-${battleId}`;
    },
    async readPoolTotals() {
      return [0n, 0n];
    },
  };
}

class OpenNotRecorded extends MemoryPoolLedger {
  override async recordOpened(): Promise<void> {
    throw new Error("connection refused");
  }
}

class ResolutionNotRecorded extends MemoryPoolLedger {
  override async recordResolved(): Promise<void> {
    throw new Error("connection refused");
  }
}

describe("startup sweep of stranded Sui pools", () => {
  it("cancels a pool still open on Sui and marks it cancelled", async () => {
    const { ledger, chain, cancelled, resolution } = await stranded([["b-open", "open"]]);
    await sweepStrandedPools(chain, ledger, timeoutMs);
    assert.deepEqual(cancelled, ["b-open"]);
    assert.equal(resolution("b-open"), "cancelled");
  });

  it("marks settled and cancelled pools resolved without cancelling them", async () => {
    const { ledger, chain, cancelled, resolution } = await stranded([
      ["b-settled", "settled"],
      ["b-cancelled", "cancelled"],
    ]);
    await sweepStrandedPools(chain, ledger, timeoutMs);
    assert.deepEqual(cancelled, []);
    assert.equal(resolution("b-settled"), "already_settled");
    assert.equal(resolution("b-cancelled"), "already_cancelled");
  });

  it("continues past pools it cannot resolve and leaves them for the next startup", async () => {
    const { ledger, chain, cancelled } = await stranded([
      ["b-fails", "read fails"],
      ["b-missing", "missing"],
      ["b-hangs", "read hangs"],
      ["b-open", "open"],
    ]);
    await sweepStrandedPools(chain, ledger, timeoutMs);
    assert.deepEqual(cancelled, ["b-open"]);
    assert.deepEqual(
      (await ledger.listUnresolved()).map((pool) => pool.battleId),
      ["b-fails", "b-missing", "b-hangs"],
    );
  });
});

describe("shutdown release of the live Sui pool", () => {
  it("cancels the live pool and marks it cancelled", async () => {
    const { ledger, chain, cancelled, resolution } = await stranded([["b-live", "open"]]);
    await releaseLivePool(
      { battleId: "b-live", poolId: poolOf("b-live") },
      chain,
      ledger,
      timeoutMs,
    );
    assert.deepEqual(cancelled, ["b-live"]);
    assert.equal(resolution("b-live"), "cancelled");
  });

  it("gives up at the timeout and leaves the pool for the startup sweep", async () => {
    const { ledger, chain, resolution } = await stranded([["b-live", "cancel hangs"]]);
    await assert.rejects(
      releaseLivePool({ battleId: "b-live", poolId: poolOf("b-live") }, chain, ledger, timeoutMs),
      /b-live.*50 ms/u,
    );
    assert.equal(resolution("b-live"), null);
  });
});

describe("recording Sui pools in sui_pools", () => {
  it("records each opened pool and marks it resolved when settled or cancelled", async () => {
    const ledger = new MemoryPoolLedger();
    const betting = recordPools(fakeBetting(), ledger);
    const settledId = "battle-settled";
    const cancelledId = "battle-cancelled";
    await betting.openBattle(settledId, 100n);
    await betting.openBattle(cancelledId, 100n);
    assert.deepEqual(
      (await ledger.listUnresolved()).map((pool) => [pool.battleId, pool.poolId]),
      [
        [settledId, poolOf(settledId)],
        [cancelledId, poolOf(cancelledId)],
      ],
    );
    assert.equal(await betting.settle(settledId, 0), `digest-${settledId}`);
    await betting.cancelBattle(cancelledId);
    assert.equal(ledger.entries.get(settledId)?.resolution, "settled");
    assert.equal(ledger.entries.get(cancelledId)?.resolution, "cancelled");
  });

  it("cancels a pool whose open could not be recorded and names it in the error", async () => {
    const calls: string[] = [];
    const betting = recordPools(fakeBetting(calls), new OpenNotRecorded());
    await assert.rejects(
      betting.openBattle("battle-1", 100n),
      /Battle battle-1: .*sui_pools failed: connection refused/u,
    );
    assert.deepEqual(calls, ["open:battle-1", "cancel:battle-1"]);
  });

  it("returns the settle digest even when marking the pool resolved fails", async () => {
    const ledger = new ResolutionNotRecorded();
    const betting = recordPools(fakeBetting(), ledger);
    const battleId = "battle-1";
    await betting.openBattle(battleId, 100n);
    assert.equal(await betting.settle(battleId, 1), `digest-${battleId}`);
    assert.deepEqual(
      (await ledger.listUnresolved()).map((pool) => pool.battleId),
      [battleId],
    );
  });
});
