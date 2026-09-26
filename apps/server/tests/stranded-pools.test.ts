import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BattleBettingPorts } from "../src/battle-betting.js";
import { MemoryPoolLedger } from "../src/db/sui-pools.js";
import { recordPools } from "../src/stranded-pools.js";

const poolOf = (battleId: string): string => `0xpool-${battleId}`;

function fakeBetting(calls: string[] = []): BattleBettingPorts {
  let opened = 0;
  return {
    config: {
      network: "testnet",
      grpcUrl: "https://example.invalid",
      packageId: "0xpkg",
      houseId: "0xhouse",
      coinType: "0x2::sui::SUI",
    },
    poolIdFor: poolOf,
    async openBattle() {
      opened += 1;
      const battleId = `battle-${String(opened)}`;
      calls.push(`open:${battleId}`);
      return battleId;
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

describe("recording Sui pools in sui_pools", () => {
  it("records each opened pool and marks it resolved when settled or cancelled", async () => {
    const ledger = new MemoryPoolLedger();
    const betting = recordPools(fakeBetting(), ledger);
    const settledId = await betting.openBattle("alpha", "bravo", 100n);
    const cancelledId = await betting.openBattle("charlie", "delta", 100n);
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
      betting.openBattle("alpha", "bravo", 100n),
      /Battle battle-1: .*sui_pools failed: connection refused/u,
    );
    assert.deepEqual(calls, ["open:battle-1", "cancel:battle-1"]);
  });

  it("returns the settle digest even when marking the pool resolved fails", async () => {
    const ledger = new ResolutionNotRecorded();
    const betting = recordPools(fakeBetting(), ledger);
    const battleId = await betting.openBattle("alpha", "bravo", 100n);
    assert.equal(await betting.settle(battleId, 1), `digest-${battleId}`);
    assert.deepEqual(
      (await ledger.listUnresolved()).map((pool) => pool.battleId),
      [battleId],
    );
  });
});
