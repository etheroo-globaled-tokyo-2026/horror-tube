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
import { normalizeSuiObjectId } from "@mysten/sui/utils";
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

export async function fetchBettingIds(
  fetchImpl: typeof fetch = fetch,
): Promise<BettingIds> {
  const res = await fetchImpl("/betting");
  if (!res.ok) {
    throw new Error(
      `GET /betting failed: HTTP ${String(res.status)} ${await res.text()}`,
    );
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

export type Claim = { tickets: Ticket[]; units: bigint; lost: bigint };

export type BetGuard = Pick<GameState, "phase" | "poolId" | "error" | "bet" | "pending">;

export const bookOpen = (round: Pick<GameState, "phase" | "poolId" | "error">): boolean =>
  round.phase === "bet" && round.poolId !== null && round.error === null;

export const canBet = (state: BetGuard): boolean =>
  bookOpen(state) && state.bet === null && state.pending === null;

export const canCollect = (state: Pick<GameState, "claim" | "pending">): boolean =>
  state.claim > 0 && state.pending === null;

export const winningsDue = (prev: Phase, next: Phase): boolean =>
  next !== prev || next === "settle";

export function tally(
  tickets: Ticket[],
  pools: ReadonlyMap<string, Pool>,
  roundPool: string | null,
): Claim {
  const round = roundPool === null ? null : normalizeSuiObjectId(roundPool);
  const claim: Claim = { tickets: [], units: 0n, lost: 0n };
  for (const ticket of tickets) {
    const pool = pools.get(ticket.poolId);
    if (pool === undefined || pool.status === PoolStatus.open) continue;
    const owed = payout(pool, ticket);
    claim.tickets.push(ticket);
    claim.units += owed;
    if (owed === 0n && ticket.poolId === round) claim.lost += ticket.stake;
  }
  return claim;
}

const finishedPools = new Map<string, Pool>();

export async function claimable(
  wallet: GameWallet,
  ids: ContractIds,
  roundPool: string | null,
): Promise<Claim> {
  const tickets = await listTickets(wallet.client, ids, wallet.address);
  for (const id of new Set(tickets.map((ticket) => ticket.poolId))) {
    if (finishedPools.has(id)) continue;
    const pool = await getPool(wallet.client, id);
    if (pool === null)
      throw new Error(`Pool ${id} holds a ticket of ${wallet.address} but is not on chain.`);
    if (pool.status !== PoolStatus.open) finishedPools.set(id, pool);
  }
  return tally(tickets, finishedPools, roundPool);
}

export const claimAll = (
  wallet: GameWallet,
  ids: ContractIds,
  tickets: Ticket[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> => runKind(wallet, claimTx(ids, tickets), fetchImpl);
