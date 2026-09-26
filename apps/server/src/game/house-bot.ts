import type { RandomInt } from "@horror-tube/fight/rotation";

export type HouseBotChain = {
  address: string;
  bet: (poolId: string, side: 0 | 1, units: bigint) => Promise<string>;
  claimFinished: () => Promise<{ digest: string; tickets: number } | null>;
};

export type HouseBots = { chains: HouseBotChain[]; stakeUnits: bigint };

export function botSide(humanStake: [number, number], randomInt: RandomInt): 0 | 1 {
  if (humanStake[0] > humanStake[1]) return 1;
  if (humanStake[1] > humanStake[0]) return 0;
  return randomInt(2) === 0 ? 0 : 1;
}
