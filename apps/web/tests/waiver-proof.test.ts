import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bootGateDecision, continueAfterSignature } from "../waiver-gate.ts";

describe("continueAfterSignature", () => {
  it("when proof is off, enters with a waiver session and does not request a World ID proof", async () => {
    const calls: string[] = [];
    await continueAfterSignature({
      worldIdProof: false,
      beginWorldIdScan: async () => {
        calls.push("scan");
      },
      enterWithWaiverSession: async () => {
        calls.push("waiver");
      },
    });
    assert.deepEqual(calls, ["waiver"]);
  });

  it("when proof is on, starts the World ID scan", async () => {
    const calls: string[] = [];
    await continueAfterSignature({
      worldIdProof: true,
      beginWorldIdScan: async () => {
        calls.push("scan");
      },
      enterWithWaiverSession: async () => {
        calls.push("waiver");
      },
    });
    assert.deepEqual(calls, ["scan"]);
  });
});

describe("bootGateDecision", () => {
  it("proof on and verified enters the room", () => {
    assert.deepEqual(
      bootGateDecision({
        worldIdProof: true,
        verified: true,
        waiver: false,
        hasWalletSession: true,
      }),
      { kind: "enter-room", mountCoinBox: true },
    );
  });

  it("proof on and only waiver stays on the waiver without mounting the coin box", () => {
    assert.deepEqual(
      bootGateDecision({
        worldIdProof: true,
        verified: false,
        waiver: true,
        hasWalletSession: true,
      }),
      { kind: "show-waiver", mountCoinBox: false },
    );
  });

  it("proof off and waiver or verified enters without a scan", () => {
    assert.deepEqual(
      bootGateDecision({
        worldIdProof: false,
        verified: false,
        waiver: true,
        hasWalletSession: false,
      }),
      { kind: "enter-room", mountCoinBox: false },
    );
    assert.deepEqual(
      bootGateDecision({
        worldIdProof: false,
        verified: true,
        waiver: false,
        hasWalletSession: true,
      }),
      { kind: "enter-room", mountCoinBox: true },
    );
  });

  it("proof off and neither flag shows the waiver", () => {
    assert.deepEqual(
      bootGateDecision({
        worldIdProof: false,
        verified: false,
        waiver: false,
        hasWalletSession: false,
      }),
      { kind: "show-waiver", mountCoinBox: false },
    );
  });
});
