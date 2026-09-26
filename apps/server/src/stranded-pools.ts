import { PoolStatus, type Pool } from "@horror-tube/betting";

import type { BattleBettingPorts } from "./battle-betting.js";
import type { PoolLedger, PoolResolution } from "./db/sui-pools.js";
import type { RoundState } from "./types.js";

export type PoolChain = {
  readPool: (poolId: string) => Promise<Pick<Pool, "status"> | null>;
  cancel: (battleId: string) => Promise<void>;
};

type LedgerPool = { battleId: string; poolId: string };

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  return Promise.race([work, expired]).finally(() => {
    clearTimeout(timer);
  });
}

async function resolveOnChain(chain: PoolChain, pool: LedgerPool): Promise<PoolResolution> {
  const found = await chain.readPool(pool.poolId);
  if (found === null) throw new Error("the pool was not found on Sui");
  if (found.status === PoolStatus.settled) return "already_settled";
  if (found.status === PoolStatus.cancelled) return "already_cancelled";
  if (found.status !== PoolStatus.open) {
    throw new Error(`the pool has unknown status ${String(found.status)}`);
  }
  await chain.cancel(pool.battleId);
  return "cancelled";
}

async function release(
  chain: PoolChain,
  ledger: PoolLedger,
  pool: LedgerPool,
  timeoutMs: number,
): Promise<PoolResolution> {
  const work = async (): Promise<PoolResolution> => {
    const resolution = await resolveOnChain(chain, pool);
    await ledger.recordResolved(pool.battleId, resolution);
    return resolution;
  };
  try {
    return await withDeadline(work(), timeoutMs);
  } catch (cause) {
    throw new Error(
      `Battle ${pool.battleId}: releasing pool ${pool.poolId} failed: ${detail(cause)}`,
      { cause },
    );
  }
}

export async function sweepStrandedPools(
  chain: PoolChain,
  ledger: PoolLedger,
  timeoutMs: number,
): Promise<void> {
  let pools;
  try {
    pools = await ledger.listUnresolved();
  } catch (cause) {
    throw new Error(
      `Sui pool sweep: reading unresolved pools from sui_pools failed: ${detail(cause)}. Apply the server migrations (pnpm --filter @horror-tube/server migrate) before starting the game.`,
      { cause },
    );
  }
  console.log(`Sui pool sweep: ${String(pools.length)} unresolved pool(s) in sui_pools.`);
  for (const pool of pools) {
    const opened = new Date(pool.openedAt).toISOString();
    try {
      const resolution = await release(chain, ledger, pool, timeoutMs);
      console.log(
        `Sui pool sweep: battle ${pool.battleId} pool ${pool.poolId} (opened ${opened}): ${resolution}.`,
      );
    } catch (cause) {
      console.error(
        `Sui pool sweep: ${detail(cause)}. Opened ${opened}; it stays unresolved and the next startup retries it.`,
      );
    }
  }
}

export async function releaseLivePool(
  live: Pick<RoundState, "battleId" | "poolId">,
  chain: PoolChain,
  ledger: PoolLedger,
  timeoutMs: number,
): Promise<void> {
  if (live.battleId === null || live.poolId === null) {
    console.log("Shutdown: no live Sui pool to release.");
    return;
  }
  const pool = { battleId: live.battleId, poolId: live.poolId };
  const resolution = await release(chain, ledger, pool, timeoutMs);
  console.log(`Shutdown: battle ${pool.battleId} pool ${pool.poolId}: ${resolution}.`);
}

async function cancelUnrecorded(ports: BattleBettingPorts, battleId: string): Promise<string> {
  try {
    await ports.cancelBattle(battleId);
    return "Cancelled it before any bet could reach it.";
  } catch (cause) {
    return `Cancelling it also failed: ${detail(cause)}. It is open on Sui with no sui_pools row; cancel it by hand.`;
  }
}

// WARNING: a failed ledger write after a successful settle or cancel is logged, not thrown. Throwing would drop the settle digest; the startup sweep reconciles the row from the chain.
async function recordResolution(
  ledger: PoolLedger,
  battleId: string,
  resolution: PoolResolution,
): Promise<void> {
  try {
    await ledger.recordResolved(battleId, resolution);
  } catch (cause) {
    console.error(
      `Battle ${battleId}: pool ${resolution} on Sui, but marking it ${resolution} in sui_pools failed: ${detail(cause)}. The next startup sweep reads the pool and marks it.`,
    );
  }
}

export function recordPools(ports: BattleBettingPorts, ledger: PoolLedger): BattleBettingPorts {
  return {
    ...ports,
    async openBattle(fighterA, fighterB, closesAtUnix) {
      const battleId = await ports.openBattle(fighterA, fighterB, closesAtUnix);
      const poolId = ports.poolIdFor(battleId);
      try {
        await ledger.recordOpened(battleId, poolId);
      } catch (cause) {
        const cancelled = await cancelUnrecorded(ports, battleId);
        throw new Error(
          `Battle ${battleId}: pool ${poolId} opened on Sui, but recording it in sui_pools failed: ${detail(cause)}. ${cancelled}`,
          { cause },
        );
      }
      return battleId;
    },
    async cancelBattle(battleId) {
      await ports.cancelBattle(battleId);
      await recordResolution(ledger, battleId, "cancelled");
    },
    async settle(battleId, side) {
      const digest = await ports.settle(battleId, side);
      await recordResolution(ledger, battleId, "settled");
      return digest;
    },
  };
}
