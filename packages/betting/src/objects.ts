import { bcs } from "@mysten/sui/bcs";
import { ObjectError, type ClientWithCoreApi, type SuiClientTypes } from "@mysten/sui/client";
import { normalizeStructTag } from "@mysten/sui/utils";
import type { ContractIds } from "./env.js";

export const PoolStatus = { open: 0, settled: 1, cancelled: 2 } as const;

const PoolBcs = bcs.struct("Pool", {
  id: bcs.Address,
  house_id: bcs.Address,
  battle_id: bcs.string(),
  closes_at_ms: bcs.u64(),
  fee_bps: bcs.u64(),
  status: bcs.u8(),
  winning_side: bcs.u64(),
  fee: bcs.u64(),
  totals: bcs.vector(bcs.u64()),
  pot: bcs.u64(),
});

const HouseBcs = bcs.struct("House", {
  id: bcs.Address,
  fee_bps: bcs.u64(),
  min_bet: bcs.u64(),
  operators: bcs.struct("VecSet", { contents: bcs.vector(bcs.Address) }),
  treasury: bcs.struct("Balance", { value: bcs.u64() }),
});

const TicketBcs = bcs.struct("Ticket", {
  id: bcs.Address,
  pool_id: bcs.Address,
  side: bcs.u64(),
  stake: bcs.u64(),
});

export function parsePool(content: Uint8Array) {
  const raw = PoolBcs.parse(content);
  const [a, b] = raw.totals.map(BigInt);
  if (raw.totals.length !== 2 || a === undefined || b === undefined)
    throw new Error(`Pool ${raw.id} has ${raw.totals.length} totals, expected 2.`);
  return {
    id: raw.id,
    houseId: raw.house_id,
    battleId: raw.battle_id,
    closesAtMs: BigInt(raw.closes_at_ms),
    feeBps: BigInt(raw.fee_bps),
    status: raw.status,
    winningSide: BigInt(raw.winning_side),
    fee: BigInt(raw.fee),
    totals: [a, b] satisfies [bigint, bigint],
    pot: BigInt(raw.pot),
  };
}

export function parseHouse(content: Uint8Array) {
  const raw = HouseBcs.parse(content);
  return { id: raw.id, feeBps: BigInt(raw.fee_bps), minBet: BigInt(raw.min_bet) };
}

export function parseTicket(content: Uint8Array) {
  const raw = TicketBcs.parse(content);
  return { id: raw.id, poolId: raw.pool_id, side: BigInt(raw.side), stake: BigInt(raw.stake) };
}

export type Pool = ReturnType<typeof parsePool>;
export type House = ReturnType<typeof parseHouse>;
export type Ticket = ReturnType<typeof parseTicket>;

export async function getHouse(
  client: ClientWithCoreApi,
  ids: Pick<ContractIds, "packageId" | "houseId" | "coinType">,
): Promise<House> {
  const { object } = await client.core.getObject({
    objectId: ids.houseId,
    include: { content: true },
  });
  const expected = `${ids.packageId}::betting::House<${ids.coinType}>`;
  if (normalizeStructTag(object.type) !== normalizeStructTag(expected))
    throw new Error(`Object ${ids.houseId} is a ${object.type}, not a ${expected}.`);
  return parseHouse(object.content);
}

export async function getPool(client: ClientWithCoreApi, id: string): Promise<Pool | null> {
  try {
    const { object } = await client.core.getObject({ objectId: id, include: { content: true } });
    return parsePool(object.content);
  } catch (error) {
    if (error instanceof ObjectError && error.reason === "notFound") return null;
    throw error;
  }
}

export async function listTickets(
  client: ClientWithCoreApi,
  ids: Pick<ContractIds, "packageId" | "coinType">,
  owner: string,
): Promise<Ticket[]> {
  const tickets: Ticket[] = [];
  let cursor: string | null = null;
  do {
    const page: SuiClientTypes.ListOwnedObjectsResponse<{ content: true }> =
      await client.core.listOwnedObjects({
        owner,
        type: `${ids.packageId}::betting::Ticket<${ids.coinType}>`,
        include: { content: true },
        cursor,
      });
    tickets.push(...page.objects.map((object) => parseTicket(object.content)));
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor !== null);
  return tickets;
}
