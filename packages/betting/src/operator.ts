import type { Signer } from "@mysten/sui/cryptography";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Transaction } from "@mysten/sui/transactions";
import type { ContractIds } from "./env.js";
import { execute } from "./execute.js";
import { poolId } from "./ids.js";
import { PoolStatus, getPool, type Pool } from "./objects.js";
import { cancelTx, closeBettingTx, openPoolTx, settleTx } from "./transactions.js";

export type OperatorChain = {
  readPool(id: string): Promise<Pool | null>;
  run(tx: Transaction): Promise<void>;
};

export function createChain(client: SuiGrpcClient, signer: Signer): OperatorChain {
  return {
    readPool: (id) => getPool(client, id),
    run: async (tx) => {
      await execute(client, signer, tx);
    },
  };
}

export function createOperator(chain: OperatorChain, ids: ContractIds, cap: string) {
  let queue: Promise<void> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const pool = (battleId: string): string => poolId(ids, battleId);
  const current = async (battleId: string): Promise<Pool> => {
    const found = await chain.readPool(pool(battleId));
    if (found === null) throw new Error(`No pool for battle ${battleId} (${pool(battleId)}).`);
    return found;
  };
  return {
    poolId: pool,
    read: current,
    openPool: (battleId: string, closesAtMs: bigint) =>
      serial(async () => {
        if ((await chain.readPool(pool(battleId))) === null)
          await chain.run(openPoolTx(ids, cap, battleId, closesAtMs));
      }),
    closeBetting: (battleId: string) =>
      serial(async () => {
        const found = await current(battleId);
        if (found.status === PoolStatus.open && found.closesAtMs > BigInt(Date.now()))
          await chain.run(closeBettingTx(ids, cap, pool(battleId)));
      }),
    settle: (battleId: string, side: 0 | 1) =>
      serial(async () => {
        const found = await current(battleId);
        if (found.status === PoolStatus.settled && found.winningSide === BigInt(side)) return;
        if (found.status !== PoolStatus.open)
          throw new Error(
            `Battle ${battleId}: pool status ${found.status}, cannot settle for side ${side}.`,
          );
        await chain.run(settleTx(ids, cap, pool(battleId), side));
      }),
    cancel: (battleId: string) =>
      serial(async () => {
        const found = await current(battleId);
        if (found.status === PoolStatus.cancelled) return;
        if (found.status !== PoolStatus.open)
          throw new Error(`Battle ${battleId}: pool is settled, cannot cancel.`);
        await chain.run(cancelTx(ids, cap, pool(battleId)));
      }),
  };
}

export type Operator = ReturnType<typeof createOperator>;
