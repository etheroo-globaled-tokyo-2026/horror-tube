import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { stakeActionForBattle } from "./action.js";
import { loadWorldIdEnv, requireEnv } from "./env.js";
import { MemoryNullifierStore } from "./nullifier-store.js";
import { createStakeRpContext } from "./sign.js";
import {
  openStakeAfterWorldIdProof,
  refuseStakeOnIdkitCancel,
} from "./stake-gate.js";
import {
  WORLD_ID_VERIFY_URL_BASE,
  extractProofOfHumanNullifier,
  verifyIdkitResultUnchanged,
  type IdkitResultPayload,
  type VerifyFetch,
} from "./verify.js";

const TEST_SIGNING_KEY =
  "0xabababababababababababababababababababababababababababababababab";
const TEST_RP_ID = "rp_test_not_a_real_portal_id";

function testEnv(): NodeJS.ProcessEnv {
  return {
    WORLD_ID_RP_ID: TEST_RP_ID,
    WORLD_ID_SIGNING_KEY: TEST_SIGNING_KEY,
  };
}

function proofPayload(action: string, nullifier: string): IdkitResultPayload {
  return {
    protocol_version: "4.0",
    nonce: "0xabc123",
    action,
    responses: [
      {
        identifier: "proof_of_human",
        nullifier,
      },
    ],
  };
}

test("stakeActionForBattle is per battle and rejects blank ids", () => {
  assert.equal(stakeActionForBattle("round-7"), "stake-battle-round-7");
  assert.throws(() => stakeActionForBattle("  "), /battleId is required/);
});

test("requireEnv and loadWorldIdEnv fail closed without inventing ids", () => {
  assert.throws(() => requireEnv("WORLD_ID_RP_ID", undefined), /WORLD_ID_RP_ID/);
  assert.throws(() => requireEnv("WORLD_ID_RP_ID", "   "), /WORLD_ID_RP_ID/);
  assert.throws(() => loadWorldIdEnv({}), /WORLD_ID_RP_ID/);
  assert.throws(
    () => loadWorldIdEnv({ WORLD_ID_RP_ID: TEST_RP_ID }),
    /WORLD_ID_SIGNING_KEY/,
  );
  const loaded = loadWorldIdEnv(testEnv());
  assert.equal(loaded.rpId, TEST_RP_ID);
  assert.equal(loaded.signingKeyHex, TEST_SIGNING_KEY);
});

test("extractProofOfHumanNullifier rejects non-PoH credentials", () => {
  assert.throws(
    () =>
      extractProofOfHumanNullifier({
        protocol_version: "4.0",
        nonce: "0x1",
        action: "stake-battle-1",
        responses: [{ identifier: "selfie", nullifier: "0xabc" }],
      }),
    /proof_of_human/,
  );
});

test("verifyIdkitResultUnchanged POSTs the payload body unchanged", async () => {
  const payload = proofPayload("stake-battle-1", "0xnullifier1");
  let postedUrl = "";
  let postedBody = "";
  const fetchImpl: VerifyFetch = async (input, init) => {
    postedUrl = input;
    postedBody = init.body;
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    };
  };

  const result = await verifyIdkitResultUnchanged({
    rpId: TEST_RP_ID,
    idkitResult: payload,
    fetchImpl,
  });

  assert.equal(postedUrl, `${WORLD_ID_VERIFY_URL_BASE}/${TEST_RP_ID}`);
  assert.equal(postedBody, JSON.stringify(payload));
  assert.equal(result.nullifier, "0xnullifier1");
});

test("verifyIdkitResultUnchanged fails closed on HTTP error", async () => {
  const fetchImpl: VerifyFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ success: false, code: "bad_proof" }),
  });

  await assert.rejects(
    () =>
      verifyIdkitResultUnchanged({
        rpId: TEST_RP_ID,
        idkitResult: proofPayload("stake-battle-1", "0xnullifier1"),
        fetchImpl,
      }),
    /World ID verify failed/,
  );
});

test("createStakeRpContext signs on the server with env signing key", () => {
  const context = createStakeRpContext({
    battleId: "42",
    env: testEnv(),
  });
  assert.equal(context.action, "stake-battle-42");
  assert.equal(context.rpId, TEST_RP_ID);
  assert.match(context.rp_context.sig, /^0x[0-9a-fA-F]+$/u);
  assert.match(context.rp_context.nonce, /^0x[0-9a-fA-F]+$/u);
  assert.ok(context.rp_context.expires_at > context.rp_context.created_at);
});

test("refuseStakeOnIdkitCancel keeps the stake closed", () => {
  const closed = refuseStakeOnIdkitCancel("battle-9");
  assert.deepEqual(closed, {
    kind: "stake_not_opened",
    reason: "idkit_cancelled",
    battleId: "battle-9",
  });
});

test("openStakeAfterWorldIdProof success path verifies, stores nullifier, opens stake", async () => {
  const store = new MemoryNullifierStore();
  const nullifier = `0x${createHash("sha256").update(randomBytes(16)).digest("hex")}`;
  const battleId = "3";
  const payload = proofPayload(stakeActionForBattle(battleId), nullifier);
  const fetchImpl: VerifyFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true }),
  });

  const opened = await openStakeAfterWorldIdProof({
    battleId,
    wallet: "0x1111111111111111111111111111111111111111",
    idkitResult: payload,
    nullifierStore: store,
    env: testEnv(),
    fetchImpl,
  });

  assert.equal(opened.kind, "stake_opened");
  assert.equal(opened.nullifier, nullifier);
  assert.equal(opened.action, "stake-battle-3");
  assert.equal(store.has(battleId, nullifier), true);

  await assert.rejects(
    () =>
      openStakeAfterWorldIdProof({
        battleId,
        wallet: "0x1111111111111111111111111111111111111111",
        idkitResult: payload,
        nullifierStore: store,
        env: testEnv(),
        fetchImpl,
      }),
    /Nullifier already used/,
  );
});

test("openStakeAfterWorldIdProof rejects action mismatch", async () => {
  const store = new MemoryNullifierStore();
  await assert.rejects(
    () =>
      openStakeAfterWorldIdProof({
        battleId: "battle-1",
        wallet: "0x1111111111111111111111111111111111111111",
        idkitResult: proofPayload("wrong-action", "0xn"),
        nullifierStore: store,
        env: testEnv(),
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => "{}",
        }),
      }),
    /action mismatch/,
  );
});
