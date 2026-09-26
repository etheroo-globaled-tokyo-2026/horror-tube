import { signRequest } from "@worldcoin/idkit-core/signing";

import { loadWorldIdEnv, type WorldIdEnvironment } from "./env.js";

export type IdkitRequestContext = {
  app_id: string;
  action: string;
  environment: WorldIdEnvironment;
  allow_legacy_proofs: false;
  rp_context: {
    rp_id: string;
    nonce: string;
    created_at: number;
    expires_at: number;
    signature: string;
  };
};

export function createIdkitRequestContext(args: {
  action: string;
  env?: NodeJS.ProcessEnv;
}): IdkitRequestContext {
  const action = args.action.trim();
  if (action === "") {
    throw new Error("action is required to sign a World ID request.");
  }
  const worldId = loadWorldIdEnv(args.env);
  const signed = signRequest({ signingKeyHex: worldId.signingKeyHex, action });
  return {
    app_id: worldId.appId,
    action,
    environment: worldId.environment,
    allow_legacy_proofs: false,
    rp_context: {
      rp_id: worldId.rpId,
      nonce: signed.nonce,
      created_at: signed.createdAt,
      expires_at: signed.expiresAt,
      signature: signed.sig,
    },
  };
}
