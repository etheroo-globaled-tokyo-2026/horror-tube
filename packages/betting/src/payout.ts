import { PoolStatus, type Pool, type Ticket } from "./objects.js";

const BPS = 10_000n;

export function poolFee(pool: Pick<Pool, "totals" | "winningSide" | "feeBps">): bigint {
  const [a, b] = pool.totals;
  const loser = pool.winningSide === 0n ? b : a;
  return a === 0n || b === 0n ? 0n : (loser * pool.feeBps) / BPS;
}

export function payout(pool: Pool, ticket: Ticket): bigint {
  if (ticket.poolId !== pool.id)
    throw new Error(`Ticket ${ticket.id} is for pool ${ticket.poolId}, not ${pool.id}.`);
  if (pool.status === PoolStatus.open) return 0n;
  const [a, b] = pool.totals;
  const [winner, loser] = pool.winningSide === 0n ? [a, b] : [b, a];
  if (pool.status === PoolStatus.cancelled || winner === 0n || loser === 0n) return ticket.stake;
  if (ticket.side !== pool.winningSide) return 0n;
  return (ticket.stake * (winner + loser - pool.fee)) / winner;
}

export function odds(totals: [bigint, bigint], feeBps: bigint, side: 0 | 1): number {
  const mine = totals[side];
  const theirs = totals[side === 0 ? 1 : 0];
  if (mine === 0n || theirs === 0n) return 1;
  return Number(mine + theirs - (theirs * feeBps) / BPS) / Number(mine);
}
