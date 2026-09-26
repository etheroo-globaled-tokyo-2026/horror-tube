import type { RandomInt } from "@horror-tube/fight/rotation";

export type HouseBotChain = {
  address: string;
  bet: (poolId: string, side: 0 | 1, units: bigint) => Promise<string>;
  claimFinished: () => Promise<{ digest: string; tickets: number } | null>;
};

export type HouseBots = { chains: HouseBotChain[]; stakeUnits: bigint };

export function botPicks(
  votable: number[],
  voted: ReadonlySet<number>,
  slots: number,
  randomInt: RandomInt,
): number[] {
  const fresh = votable.filter((id) => !voted.has(id));
  const rest = votable.filter((id) => voted.has(id));
  const picks: number[] = [];
  for (const pool of [fresh, rest]) {
    while (picks.length < slots && pool.length > 0) {
      const [id] = pool.splice(randomInt(pool.length), 1);
      if (id !== undefined) picks.push(id);
    }
  }
  if (picks.length < slots)
    throw new Error(
      `House bot needs ${String(slots)} votable characters; only ${String(votable.length)} are votable.`,
    );
  return picks;
}

export function botSide(humanStake: [number, number], randomInt: RandomInt): 0 | 1 {
  if (humanStake[0] > humanStake[1]) return 1;
  if (humanStake[1] > humanStake[0]) return 0;
  return randomInt(2) === 0 ? 0 : 1;
}
