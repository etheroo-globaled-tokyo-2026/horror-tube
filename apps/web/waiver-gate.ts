import * as v from "valibot";

export type BootGateDecision =
  | { kind: "enter-room"; mountCoinBox: boolean }
  | { kind: "show-waiver"; mountCoinBox: boolean };

export type ContinueAfterSignatureOpts = {
  worldIdProof: boolean;
  beginWorldIdScan: () => Promise<void>;
  enterWithWaiverSession: () => Promise<void>;
};

export async function continueAfterSignature(opts: ContinueAfterSignatureOpts): Promise<void> {
  if (opts.worldIdProof) {
    await opts.beginWorldIdScan();
    return;
  }
  await opts.enterWithWaiverSession();
}

export function bootGateDecision(opts: {
  worldIdProof: boolean;
  verified: boolean;
  waiver: boolean;
  hasWalletSession: boolean;
}): BootGateDecision {
  if (opts.worldIdProof) {
    if (opts.verified) {
      return { kind: "enter-room", mountCoinBox: opts.hasWalletSession };
    }
    return { kind: "show-waiver", mountCoinBox: false };
  }
  if (opts.waiver || opts.verified) {
    return { kind: "enter-room", mountCoinBox: opts.hasWalletSession };
  }
  return { kind: "show-waiver", mountCoinBox: false };
}

const ConfigResponse = v.object({ worldIdProof: v.boolean() });

export async function fetchWorldIdProof(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchImpl("/config");
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET /config failed: HTTP ${String(res.status)} body=${text}`);
  }
  let parsed;
  try {
    parsed = v.safeParse(ConfigResponse, JSON.parse(text));
  } catch (err) {
    throw new Error(
      `GET /config returned non-JSON. Underlying: ${err instanceof Error ? err.message : String(err)} body=${text}`,
      { cause: err },
    );
  }
  if (!parsed.success) {
    throw new Error(`GET /config returned an invalid body. body=${text}`);
  }
  return parsed.output.worldIdProof;
}
