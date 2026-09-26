import { signRequest } from "@worldcoin/idkit-core/signing";

import { stakeActionForBattle } from "./action.js";
import { loadWorldIdEnv } from "./env.js";

export type StakeRpContext = {
  action: string;
  rpId: string;
  rp_context: {
    sig: string;
    nonce: string;
    created_at: number;
    expires_at: number;
  };
};

export function createStakeRpContext(args: {
  battleId: string;
  env?: NodeJS.ProcessEnv;
}): StakeRpContext {
  const worldId = loadWorldIdEnv(args.env);
  const action = stakeActionForBattle(args.battleId);
  const signed = signRequest({
    signingKeyHex: worldId.signingKeyHex,
    action,
  });
  return {
    action,
    rpId: worldId.rpId,
    rp_context: {
      sig: signed.sig,
      nonce: signed.nonce,
      created_at: signed.createdAt,
      expires_at: signed.expiresAt,
    },
  };
}
