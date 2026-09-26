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

export type BattleBettingPorts = {
  openBattle: (battleId: string, closesAtUnix: bigint) => Promise<void>;
  cancelBattle: (battleId: string) => Promise<void>;
  closeBetting: (battleId: string) => Promise<void>;
  settle: (battleId: string, side: 0 | 1) => Promise<string>;
  poolIdFor: (battleId: string) => string;
  readPoolTotals: (battleId: string) => Promise<[bigint, bigint]>;
  config: BettingConfig;
};

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
    async openBattle(battleId, closesAtUnix) {
      await operator.openPool(battleId, closesAtUnix * 1000n);
    },
    async cancelBattle(battleId) {
      await operator.cancel(battleId);
    },
    async closeBetting(battleId) {
      await operator.closeBetting(battleId);
    },
    async settle(battleId, side) {
      const pool = operator.poolId(battleId);
      let digest: string | null;
      try {
        digest = await operator.settle(battleId, side);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Battle ${battleId}: settle on pool ${pool} for side ${String(side)} failed. ${detail}`,
          { cause },
        );
      }
      if (digest === null) {
        throw new Error(
          `Battle ${battleId}: pool ${pool} was already settled for side ${String(side)} before this call, so this process has no settle digest to record. Find the settle transaction on the explorer and record it by hand.`,
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
