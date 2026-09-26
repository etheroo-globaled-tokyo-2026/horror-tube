import { stakeActionForBattle } from "./action.js";
import { loadWorldIdEnv } from "./env.js";
import type { NullifierStore } from "./nullifier-store.js";
import {
  type IdkitResultPayload,
  type VerifyFetch,
  verifyIdkitResultUnchanged,
} from "./verify.js";

export type StakeGateClosed = {
  kind: "stake_not_opened";
  reason: "idkit_cancelled";
  battleId: string;
};

export type StakeGateOpened = {
  kind: "stake_opened";
  battleId: string;
  wallet: string;
  action: string;
  nullifier: string;
};

export type StakeGateResult = StakeGateClosed | StakeGateOpened;

export function refuseStakeOnIdkitCancel(battleId: string): StakeGateClosed {
  const trimmed = battleId.trim();
  if (trimmed === "") {
    throw new Error(
      "battleId is required when recording an IDKit cancel. Stake stays closed.",
    );
  }
  return {
    kind: "stake_not_opened",
    reason: "idkit_cancelled",
    battleId: trimmed,
  };
}

export async function openStakeAfterWorldIdProof(args: {
  battleId: string;
  wallet: string;
  idkitResult: IdkitResultPayload;
  nullifierStore: NullifierStore;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: VerifyFetch;
}): Promise<StakeGateOpened> {
  const battleId = args.battleId.trim();
  if (battleId === "") {
    throw new Error("battleId is required to open a stake.");
  }

  const wallet = args.wallet.trim();
  if (wallet === "") {
    throw new Error(
      "wallet (World ID signal) is required to open a stake. Refusing to invent an address.",
    );
  }

  const expectedAction = stakeActionForBattle(battleId);
  if (args.idkitResult.action !== expectedAction) {
    throw new Error(
      `World ID action mismatch for battle_id=${battleId}. expected=${expectedAction} got=${args.idkitResult.action}`,
    );
  }

  const { rpId } = loadWorldIdEnv(args.env);
  const verified = await verifyIdkitResultUnchanged({
    rpId,
    idkitResult: args.idkitResult,
    fetchImpl: args.fetchImpl,
  });

  args.nullifierStore.claim(battleId, verified.nullifier);

  return {
    kind: "stake_opened",
    battleId,
    wallet,
    action: verified.action,
    nullifier: verified.nullifier,
  };
}
