import type { GameWallet } from "./wallet.ts";

export type EntryStage = "verify" | "wallet" | "coinBox";

const STAGE_FAILED = {
  verify: "The World ID check failed.",
  wallet: "Your World ID passed, but opening your wallet failed.",
  coinBox: "Your World ID passed, but opening the coin box failed.",
} satisfies Record<EntryStage, string>;

export class EntryError extends Error {
  readonly stage: EntryStage;
  constructor(stage: EntryStage, cause: unknown) {
    super(`${STAGE_FAILED[stage]} ${cause instanceof Error ? cause.message : String(cause)}`, {
      cause,
    });
    this.stage = stage;
  }
}

export type EntrySteps<TProof> = {
  verify: (idkitResult: TProof) => Promise<void>;
  openWallet: (idkitResultJson: string) => Promise<GameWallet>;
  mountCoinBox: (wallet: GameWallet) => Promise<void>;
  onVerified: () => void;
};

async function during<T>(stage: EntryStage, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    throw new EntryError(stage, cause);
  }
}

export async function enterWithProof<TProof>(
  idkitResult: TProof,
  steps: EntrySteps<TProof>,
  signal: AbortSignal,
): Promise<"entered" | "cancelled"> {
  await during("verify", () => steps.verify(idkitResult));
  if (signal.aborted) return "cancelled";
  steps.onVerified();
  const wallet = await during("wallet", () => steps.openWallet(JSON.stringify(idkitResult)));
  await during("coinBox", () => steps.mountCoinBox(wallet));
  return "entered";
}

export function entryFailLine(error: Error): string {
  if (error instanceof EntryError && error.stage !== "verify") return error.message;
  const message = error.message;
  if (/nullifier_replayed|max_verifications_reached|already used/iu.test(message))
    return "This World ID already used its one entry.";
  if (/user_rejected|cancelled/iu.test(message)) return "The scan was cancelled.";
  if (/credential_unavailable/iu.test(message)) return "World App has no Orb credential.";
  return error instanceof EntryError ? message : `The World ID scan failed. ${message}`;
}
