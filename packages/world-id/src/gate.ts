import { loadWorldIdEnv } from "./env.js";
import { NullifierAlreadyUsedError, type NullifierStore } from "./nullifier-store.js";
import {
  parseProofOfHumanResult,
  type IdkitResultJson,
  verifyProofOfHuman,
  type VerifiedHuman,
  type VerifyFetch,
} from "./verify.js";

export async function claimHumanAction(args: {
  action: string;
  signal: string | null;
  idkitResult: IdkitResultJson;
  nullifierStore: NullifierStore;
  fetch: VerifyFetch;
  env?: NodeJS.ProcessEnv;
}): Promise<VerifiedHuman> {
  const worldId = loadWorldIdEnv(args.env);
  const [item] = parseProofOfHumanResult(args.idkitResult).responses;
  if (await args.nullifierStore.has(args.action, item.nullifier)) {
    throw new NullifierAlreadyUsedError(args.action);
  }
  const verified = await verifyProofOfHuman({
    rpId: worldId.rpId,
    environment: worldId.environment,
    stagingToken: worldId.stagingToken,
    action: args.action,
    signal: args.signal,
    idkitResult: args.idkitResult,
    fetch: args.fetch,
  });
  await args.nullifierStore.claim(verified.action, verified.nullifier);
  return verified;
}
