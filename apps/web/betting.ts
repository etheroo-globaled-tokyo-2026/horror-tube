import {
  betTx,
  claimTx,
  getPool,
  listTickets,
  payout,
  PoolStatus,
  type ContractIds,
  type Pool,
  type Ticket,
} from "@horror-tube/betting";
import * as v from "valibot";

import type { GameState, Phase } from "./game.ts";
import { runKind, type GameWallet } from "./wallet.ts";

const BettingIds = v.object({
  packageId: v.pipe(v.string(), v.minLength(1)),
  houseId: v.pipe(v.string(), v.minLength(1)),
  coinType: v.pipe(v.string(), v.minLength(1)),
  feeBps: v.number(),
});
export type BettingIds = v.InferOutput<typeof BettingIds>;

export async function fetchBettingIds(fetchImpl: typeof fetch = fetch): Promise<BettingIds> {
  const res = await fetchImpl("/betting");
  if (!res.ok) {
    throw new Error(`GET /betting failed: HTTP ${String(res.status)} ${await res.text()}`);
  }
  const parsed = v.safeParse(BettingIds, await res.json());
  if (!parsed.success) {
    throw new Error(`GET /betting returned bad betting IDs: ${v.summarize(parsed.issues)}`);
  }
  return parsed.output;
}

export function toContractIds(ids: BettingIds): ContractIds {
  return {
    packageId: ids.packageId,
    houseId: ids.houseId,
    coinType: ids.coinType,
  };
}

export const placeBet = (
  wallet: GameWallet,
  ids: ContractIds,
  poolId: string,
  side: 0 | 1,
  units: bigint,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => runKind(wallet, betTx(ids, poolId, side, units), fetchImpl);

export type Claim = { tickets: Ticket[]; units: bigint };

export type BetOutcome = { kind: "won" | "lost" | "refund"; usdc: number };

export type BetGuard = Pick<GameState, "phase" | "poolId" | "error" | "bet" | "pending">;

export const bookOpen = (round: Pick<GameState, "phase" | "poolId" | "error">): boolean =>
  round.phase === "bet" && round.poolId !== null && round.error === null;

export const canBet = (state: BetGuard): boolean =>
  bookOpen(state) && state.bet === null && state.pending === null;

export const canCollect = (state: Pick<GameState, "claim" | "pending">): boolean =>
  state.claim > 0 && state.pending === null;

export const winningsDue = (prev: Phase, next: Phase): boolean =>
  next !== prev || next === "settle";

export function betOutcome(
  bet: { side: number; amt: number },
  winner: 0 | 1,
  pool: [number, number],
  feeBps: number,
): BetOutcome {
  const mine = pool[winner];
  const theirs = pool[winner === 0 ? 1 : 0];
  if (mine <= 0 || theirs <= 0) return { kind: "refund", usdc: bet.amt };
  if (bet.side !== winner) return { kind: "lost", usdc: bet.amt };
  const fee = (theirs * feeBps) / 10_000;
  return { kind: "won", usdc: (bet.amt * (mine + theirs - fee)) / mine };
}

export function tally(tickets: Ticket[], pools: ReadonlyMap<string, Pool>): Claim {
  const claim: Claim = { tickets: [], units: 0n };
  for (const ticket of tickets) {
    const pool = pools.get(ticket.poolId);
    if (pool === undefined || pool.status === PoolStatus.open) continue;
    const owed = payout(pool, ticket);
    claim.tickets.push(ticket);
    claim.units += owed;
  }
  return claim;
}

const finishedPools = new Map<string, Pool>();

export async function claimable(wallet: GameWallet, ids: ContractIds): Promise<Claim> {
  const tickets = await listTickets(wallet.client, ids, wallet.address);
  for (const id of new Set(tickets.map((ticket) => ticket.poolId))) {
    if (finishedPools.has(id)) continue;
    const pool = await getPool(wallet.client, id);
    if (pool === null)
      throw new Error(`Pool ${id} holds a ticket of ${wallet.address} but is not on chain.`);
    if (pool.status !== PoolStatus.open) finishedPools.set(id, pool);
  }
  return tally(tickets, finishedPools);
}

export const claimAll = (
  wallet: GameWallet,
  ids: ContractIds,
  tickets: Ticket[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> => runKind(wallet, claimTx(ids, tickets), fetchImpl);
