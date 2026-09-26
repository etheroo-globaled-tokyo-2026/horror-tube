import { loadWorldIdEnv } from "./env.js";
import { NullifierAlreadyUsedError, type NullifierStore } from "./nullifier-store.js";
import {
  parseProofOfHumanResult,
  verifyProofOfHuman,
  type VerifiedHuman,
  type VerifyFetch,
} from "./verify.js";

export async function claimHumanAction(args: {
  action: string;
  signal: string | null;
  idkitResult: unknown;
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
    action: args.action,
    signal: args.signal,
    idkitResult: args.idkitResult,
    fetch: args.fetch,
    stagingVerificationToken: worldId.stagingVerificationToken,
  });
  await args.nullifierStore.claim(verified.action, verified.nullifier);
  return verified;
}
