import type { BattleBettingPorts } from "./battle-betting.js";
import type { PoolLedger, PoolResolution } from "./db/sui-pools.js";

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
