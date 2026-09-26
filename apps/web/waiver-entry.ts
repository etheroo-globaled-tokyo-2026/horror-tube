import * as v from "valibot";

import type { GameWallet } from "./wallet.ts";

export type EntryStage = "verify" | "wallet" | "coinBox";

const FailureBody = v.object({
  error: v.string(),
  code: v.optional(v.string()),
  detail: v.optional(v.string()),
});

export class EntryDownError extends Error {
  readonly detail: string;
  constructor(message: string, detail: string) {
    super(message);
    this.name = "EntryDownError";
    this.detail = detail;
  }
}

function readFailureBody(text: string): v.InferOutput<typeof FailureBody> | null {
  try {
    const parsed = v.safeParse(FailureBody, JSON.parse(text));
    return parsed.success ? parsed.output : null;
  } catch {
    return null;
  }
}

export function requestFailure(path: string, status: number, text: string): Error {
  const body = readFailureBody(text);
  const message = `POST ${path} failed: HTTP ${String(status)} ${body?.error ?? text}`;
  if (body?.code === "world_id_misconfigured") {
    return new EntryDownError(message, body.detail ?? body.error);
  }
  return new Error(message);
}

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

function downCause(error: Error): EntryDownError | null {
  const cause = error instanceof EntryError ? error.cause : error;
  return cause instanceof EntryDownError ? cause : null;
}

export function entryDownDetail(error: Error): string | null {
  return downCause(error)?.detail ?? null;
}

export function entryFailLine(error: Error): string {
  if (downCause(error) !== null) {
    return "Entry is down on our side, not yours. Nobody can get in until we fix it.";
  }
  if (error instanceof EntryError && error.stage !== "verify") return error.message;
  const message = error.message;
  if (/nullifier_replayed|max_verifications_reached|already used/iu.test(message))
    return "An entry is already registered to this World ID.";
  if (/user_rejected|cancelled/iu.test(message)) return "The scan was cancelled.";
  if (/credential_unavailable/iu.test(message))
    return "World App could not provide the required proof of a human viewer aged 18 or older.";
  return error instanceof EntryError ? message : `The World ID scan failed. ${message}`;
}
