import { Transaction } from "@mysten/sui/transactions";
import type { ContractIds } from "./env.js";
import type { Ticket } from "./objects.js";

const target = (ids: ContractIds, name: string): string => `${ids.packageId}::betting::${name}`;

export function betTx(ids: ContractIds, pool: string, side: 0 | 1, amount: bigint): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(ids, "bet"),
    typeArguments: [ids.coinType],
    arguments: [
      tx.object(ids.houseId),
      tx.object(pool),
      tx.pure.u64(side),
      tx.coin({ type: ids.coinType, balance: amount, useGasCoin: false }),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function claimTx(ids: ContractIds, tickets: Ticket[]): Transaction {
  const tx = new Transaction();
  for (const ticket of tickets)
    tx.moveCall({
      target: target(ids, "claim"),
      typeArguments: [ids.coinType],
      arguments: [tx.object(ticket.poolId), tx.object(ticket.id)],
    });
  return tx;
}

export function openPoolTx(
  ids: ContractIds,
  cap: string,
  battleId: string,
  closesAtMs: bigint,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(ids, "open_pool"),
    typeArguments: [ids.coinType],
    arguments: [
      tx.object(ids.houseId),
      tx.object(cap),
      tx.pure.string(battleId),
      tx.pure.u64(closesAtMs),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function closeBettingTx(ids: ContractIds, cap: string, pool: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(ids, "close_betting"),
    typeArguments: [ids.coinType],
    arguments: [tx.object(ids.houseId), tx.object(cap), tx.object(pool), tx.object.clock()],
  });
  return tx;
}

export function settleTx(ids: ContractIds, cap: string, pool: string, side: 0 | 1): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(ids, "settle"),
    typeArguments: [ids.coinType],
    arguments: [
      tx.object(ids.houseId),
      tx.object(cap),
      tx.object(pool),
      tx.pure.u64(side),
      tx.object.clock(),
    ],
  });
  return tx;
}

export function cancelTx(ids: ContractIds, cap: string, pool: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(ids, "cancel"),
    typeArguments: [ids.coinType],
    arguments: [tx.object(ids.houseId), tx.object(cap), tx.object(pool)],
  });
  return tx;
}
