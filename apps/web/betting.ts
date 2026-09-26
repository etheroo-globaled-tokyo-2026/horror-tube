import {
  betTx,
  claimTx,
  getPool,
  listTickets,
  payout,
  PoolStatus,
  type ContractIds,
  type Ticket,
} from "@horror-tube/betting";
import * as v from "valibot";

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

export async function claimable(
  wallet: GameWallet,
  ids: ContractIds,
): Promise<{ tickets: Ticket[]; units: bigint; lost: bigint }> {
  const tickets: Ticket[] = [];
  let units = 0n;
  let lost = 0n;
  for (const ticket of await listTickets(wallet.client, ids, wallet.address)) {
    const pool = await getPool(wallet.client, ticket.poolId);
    if (pool === null || pool.status === PoolStatus.open) continue;
    const owed = payout(pool, ticket);
    tickets.push(ticket);
    units += owed;
    if (owed === 0n) lost += ticket.stake;
  }
  return { tickets, units, lost };
}

export const claimAll = (
  wallet: GameWallet,
  ids: ContractIds,
  tickets: Ticket[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> => runKind(wallet, claimTx(ids, tickets), fetchImpl);
