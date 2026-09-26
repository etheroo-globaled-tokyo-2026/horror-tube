import {
  betTx,
  claimTx,
  createClient,
  execute,
  getPool,
  listTickets,
  PoolStatus,
  readKeypairs,
  readUnits,
  type BettingConfig,
  type Ticket,
} from "@horror-tube/betting";

import type { HouseBotChain } from "./game/house-bot.js";

export function readHouseBotStakeUnits(env: NodeJS.ProcessEnv = process.env): bigint {
  const units = readUnits("HOUSE_BOT_STAKE_UNITS", env);
  if (units < 1n)
    throw new Error("HOUSE_BOT_STAKE_UNITS must be at least 1 base unit. See .env.example.");
  return units;
}

function withTimeout<T>(run: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${String(ms)} ms`)), ms);
  });
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

export function createHouseBotChains(
  config: BettingConfig,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
): HouseBotChain[] {
  const client = createClient(config);
  return readKeypairs("HOUSE_BOT_SUI_PRIVATE_KEYS", env).map((signer) => {
    const address = signer.toSuiAddress();
    const finishedTickets = async (): Promise<Ticket[]> => {
      const tickets = await listTickets(client, config, address);
      const finished: Ticket[] = [];
      for (const poolId of new Set(tickets.map((t) => t.poolId))) {
        const pool = await getPool(client, poolId);
        if (pool === null)
          throw new Error(
            `Pool ${poolId} holds a ticket of house bot ${address} but is not on chain.`,
          );
        if (pool.status !== PoolStatus.open)
          finished.push(...tickets.filter((t) => t.poolId === poolId));
      }
      return finished;
    };
    return {
      address,
      bet: (poolId, side, units) =>
        withTimeout(
          execute(client, signer, betTx(config, poolId, side, units)).then((r) => r.digest),
          timeoutMs,
          `house bot ${address} bet on pool ${poolId}`,
        ),
      claimFinished: () =>
        withTimeout(
          (async () => {
            const tickets = await finishedTickets();
            if (tickets.length === 0) return null;
            const { digest } = await execute(client, signer, claimTx(config, tickets));
            return { digest, tickets: tickets.length };
          })(),
          timeoutMs,
          `house bot ${address} claim`,
        ),
    };
  });
}
