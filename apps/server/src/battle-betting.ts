import {
  createChain,
  createClient,
  createOperator,
  getHouse,
  readBettingConfig,
  requiredEnv,
  readKeypair,
  type Operator,
  type BettingConfig,
} from "@horror-tube/betting";
import { randomUUID } from "node:crypto";

export type BattleBettingPorts = {
  /**
   * Operator: open a Sui pool for a fresh battle id.
   * Returns the battle id string used as the pool key (not a Sepolia uint256).
   */
  openBattle: (
    fighterA: string,
    fighterB: string,
    closesAtUnix: bigint,
  ) => Promise<string>;
  /** Operator: cancel an open pool so stakes refund. */
  cancelBattle: (battleId: string) => Promise<void>;
  /** Operator: end betting early. */
  closeBetting: (battleId: string) => Promise<void>;
  /** Operator: settle with the winning side (0 or 1). Returns the settle transaction digest. */
  settle: (battleId: string, side: 0 | 1) => Promise<string>;
  /** Derived pool object id for a battle. */
  poolIdFor: (battleId: string) => string;
  /** Live pool totals in USDC base units. Throws if the pool is missing. */
  readPoolTotals: (battleId: string) => Promise<[bigint, bigint]>;
  /** Public config the web needs to build bet/claim kinds. */
  config: BettingConfig;
};

/**
 * Sui betting operator for open / cancel / close / settle.
 * Players place bets through POST /tx (Shinami), not through this port.
 * Missing env fails by name — no Sepolia BATTLE_BETTING_ADDRESS fallback.
 */
export function createBattleBettingPorts(
  env: NodeJS.ProcessEnv = process.env,
): BattleBettingPorts {
  const config = readBettingConfig(env);
  const operatorKey = readKeypair("SUI_OPERATOR_PRIVATE_KEY", env);
  const operatorCap = requiredEnv("SUI_OPERATOR_CAP_ID", env);
  const client = createClient(config);
  const operator: Operator = createOperator(
    createChain(client, operatorKey),
    config,
    operatorCap,
  );

  return {
    config,
    poolIdFor: (battleId) => operator.poolId(battleId),
    async openBattle(_fighterA, _fighterB, closesAtUnix) {
      const battleId = randomUUID();
      const closesAtMs = closesAtUnix * 1000n;
      await operator.openPool(battleId, closesAtMs);
      return battleId;
    },
    async cancelBattle(battleId) {
      await operator.cancel(battleId);
    },
    async closeBetting(battleId) {
      await operator.closeBetting(battleId);
    },
    async settle(battleId, side) {
      const digest = await operator.settle(battleId, side);
      if (digest === null) {
        throw new Error(
          `Battle ${battleId}: pool ${operator.poolId(battleId)} was already settled for side ${String(side)} before this call, so this process has no settle digest to record. Find the settle transaction on the explorer and record it by hand.`,
        );
      }
      return digest;
    },
    async readPoolTotals(battleId) {
      const pool = await operator.read(battleId);
      return pool.totals;
    },
  };
}

export async function readHouseFeeBps(config: BettingConfig): Promise<number> {
  try {
    const house = await getHouse(createClient(config), config);
    return Number(house.feeBps);
  } catch (cause) {
    const detail = (cause instanceof Error ? cause.message : String(cause)).replace(/\.$/u, "");
    throw new Error(
      `Cannot read the betting House BETTING_HOUSE_ID=${config.houseId} on Sui ${config.network} (${config.grpcUrl}): ${detail}. Check BETTING_HOUSE_ID in .env. See .env.example.`,
      { cause },
    );
  }
}
