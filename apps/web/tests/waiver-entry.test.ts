import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SuiGrpcClient } from "@mysten/sui/grpc";

import { EntryError, entryFailLine, enterWithProof, type EntrySteps } from "../waiver-entry.ts";
import type { GameWallet } from "../wallet.ts";

const PROOF = { protocol_version: "4.0", responses: ["orb"] };

const WALLET: GameWallet = {
  address: `0x${"11".repeat(32)}`,
  session: "signed-session",
  client: new SuiGrpcClient({ network: "testnet", baseUrl: "http://127.0.0.1:1" }),
};

function recordingSteps(overrides: Partial<EntrySteps<typeof PROOF>> = {}) {
  const seen: string[] = [];
  const steps: EntrySteps<typeof PROOF> = {
    verify: async () => {
      seen.push("verify");
    },
    openWallet: async (json) => {
      seen.push(`openWallet ${json}`);
      return WALLET;
    },
    mountCoinBox: async (wallet) => {
      seen.push(`mountCoinBox ${wallet.address}`);
    },
    onVerified: () => {
      seen.push("verified");
    },
    ...overrides,
  };
  return { steps, seen };
}

async function rejection<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise;
  } catch (cause) {
    assert.ok(cause instanceof Error);
    return cause;
  }
  assert.fail("expected the entry to reject");
}

describe("enter-room after the World ID proof", () => {
  it("leaves the scan step as soon as verify passes, then mounts the wallet it opened", async () => {
    const { steps, seen } = recordingSteps();
    const outcome = await enterWithProof(PROOF, steps, new AbortController().signal);
    assert.equal(outcome, "entered");
    assert.deepEqual(seen, [
      "verify",
      "verified",
      `openWallet ${JSON.stringify(PROOF)}`,
      `mountCoinBox ${WALLET.address}`,
    ]);
  });

  it("names the wallet step and keeps the server reason when the wallet fails", async () => {
    const { steps, seen } = recordingSteps({
      openWallet: async () => {
        throw new Error("POST /wallet failed: HTTP 502 Shinami timed out");
      },
    });
    const error = await rejection(enterWithProof(PROOF, steps, new AbortController().signal));
    assert.ok(error instanceof EntryError);
    assert.equal(error.stage, "wallet");
    assert.deepEqual(seen, ["verify", "verified"]);
    const line = entryFailLine(error);
    assert.match(line, /opening your wallet failed/iu);
    assert.match(line, /HTTP 502 Shinami timed out/u);
    assert.doesNotMatch(line, /scan failed/iu);
  });

  it("does not open a wallet when the scan was cancelled during verify", async () => {
    const abort = new AbortController();
    const { steps, seen } = recordingSteps({
      verify: async () => {
        abort.abort();
      },
    });
    assert.equal(await enterWithProof(PROOF, steps, abort.signal), "cancelled");
    assert.deepEqual(seen, []);
  });
});
