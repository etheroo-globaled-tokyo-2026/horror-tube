import { bcs } from "@mysten/sui/bcs";
import { deriveObjectID } from "@mysten/sui/utils";
import type { ContractIds } from "./env.js";

export function poolId(ids: Pick<ContractIds, "packageId" | "houseId">, battleId: string): string {
  return deriveObjectID(
    ids.houseId,
    `${ids.packageId}::betting::PoolKey`,
    bcs.string().serialize(battleId).toBytes(),
  );
}
