import assert from "node:assert/strict";
import test from "node:test";

import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { computeRpSignatureMessage } from "@worldcoin/idkit-core/signing";
import { hexToBytes, isHex, recoverMessageAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  MemoryNullifierStore,
  NullifierAlreadyUsedError,
  WORLD_ID_VERIFY_URL_BASE,
  claimHumanAction,
  createIdkitRequestContext,
  loadWorldIdEnv,
  parseProofOfHumanResult,
  stakeActionForBattle,
  verifyProofOfHuman,
  voteActionForRound,
  type VerifyFetch,
} from "../src/index.js";

const SIGNING_KEY = `0x${"ab".repeat(32)}` as const;
const RP_ID = "rp_unit_test";
const APP_ID = "app_unit_test";
const WALLET = "0x1111111111111111111111111111111111111111";
const NULLIFIER = "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8";
const NULLIFIER_DECIMAL = BigInt(NULLIFIER).toString(10);

function testEnv(): NodeJS.ProcessEnv {
  return {
    WORLD_ID_APP_ID: APP_ID,
    WORLD_ID_RP_ID: RP_ID,
    WORLD_ID_SIGNING_KEY: SIGNING_KEY,
    WORLD_ID_ENVIRONMENT: "production",
  };
}

function pohItem() {
  return {
    identifier: "proof_of_human",
    signal_hash: hashSignal(WALLET),
    proof: ["0x111", "0x222", "0x333", "0x444", "0x555"],
    nullifier: NULLIFIER,
    issuer_schema_id: 1,
    expires_at_min: 1756166400,
  };
}

function v4Result(action: string) {
  return {
    protocol_version: "4.0",
    nonce: "0xabc123",
    action,
    environment: "production",
    responses: [pohItem()],
  };
}

function portalSuccess(action: string) {
  return {
    success: true,
    action,
    nullifier: NULLIFIER,
    environment: "production",
    results: [{ identifier: "proof_of_human", success: true, nullifier: NULLIFIER }],
  };
}

type Call = { url: string; body: string };

function scriptedFetch(status: number, body: string) {
  const calls: Call[] = [];
  const fetch: VerifyFetch = async (url, init) => {
    assert.equal(init.method, "POST");
    assert.equal(init.headers["content-type"], "application/json");
    calls.push({ url, body: init.body });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { fetch, calls };
}

const neverFetch: VerifyFetch = async () => {
  throw new Error("fetch must not be called");
};

test("action names are per round and per battle", () => {
  assert.equal(voteActionForRound("7"), "vote-round-7");
  assert.equal(stakeActionForBattle("42"), "stake-battle-42");
  assert.throws(() => voteActionForRound(" "), /roundId is required/);
  assert.throws(() => stakeActionForBattle(""), /battleId is required/);
});

test("loadWorldIdEnv names each missing or blank variable and .env.example", () => {
  for (const name of [
    "WORLD_ID_APP_ID",
    "WORLD_ID_RP_ID",
    "WORLD_ID_SIGNING_KEY",
    "WORLD_ID_ENVIRONMENT",
  ]) {
    assert.throws(
      () => loadWorldIdEnv({ ...testEnv(), [name]: undefined }),
      new RegExp(`${name} is required.*\\.env\\.example`),
    );
    assert.throws(
      () => loadWorldIdEnv({ ...testEnv(), [name]: "   " }),
      new RegExp(`${name} is required`),
    );
  }
  assert.throws(() => loadWorldIdEnv({ ...testEnv(), WORLD_ID_SIGNING_KEY: "0x12" }), /32-byte/);
  assert.throws(
    () => loadWorldIdEnv({ ...testEnv(), WORLD_ID_ENVIRONMENT: "dev" }),
    /production or staging/,
  );
  assert.deepEqual(loadWorldIdEnv(testEnv()), {
    appId: APP_ID,
    rpId: RP_ID,
    signingKeyHex: SIGNING_KEY,
    environment: "production",
  });
});

test("RP signature message matches the World ID 4.0 spec test vector", () => {
  const message = computeRpSignatureMessage(
    hexToBytes("0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd"),
    1700000000,
    1700000300,
    "test-action",
  );
  assert.equal(
    toHex(message),
    "0x01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a",
  );
});

test("createIdkitRequestContext signs with WORLD_ID_SIGNING_KEY and refuses legacy proofs", async () => {
  const context = createIdkitRequestContext({ action: "vote-round-3", env: testEnv() });
  assert.equal(context.app_id, APP_ID);
  assert.equal(context.rp_context.rp_id, RP_ID);
  assert.equal(context.allow_legacy_proofs, false);
  assert.equal(context.environment, "production");
  assert.equal(context.rp_context.expires_at - context.rp_context.created_at, 300);

  const { nonce, signature } = context.rp_context;
  assert.ok(isHex(nonce));
  assert.ok(isHex(signature));
  const message = computeRpSignatureMessage(
    hexToBytes(nonce),
    context.rp_context.created_at,
    context.rp_context.expires_at,
    context.action,
  );
  const signer = await recoverMessageAddress({ message: { raw: message }, signature });
  assert.equal(signer, privateKeyToAccount(SIGNING_KEY).address);

  assert.throws(
    () =>
      createIdkitRequestContext({
        action: "vote-round-3",
        env: { ...testEnv(), WORLD_ID_SIGNING_KEY: "" },
      }),
    /WORLD_ID_SIGNING_KEY is required/,
  );
});

test("parseProofOfHumanResult rejects legacy, session, and non-Orb results", () => {
  const base = v4Result("vote-round-1");
  const item = pohItem();
  assert.equal(parseProofOfHumanResult(base).responses[0].nullifier, NULLIFIER_DECIMAL);
  const rejected: [unknown, RegExp][] = [
    [{ ...base, protocol_version: "3.0" }, /legacy proofs are rejected/],
    [{ ...base, session_id: "session_x" }, /session proofs are rejected/],
    [{ ...base, responses: [{ ...item, identifier: "orb" }] }, /identifier must be proof_of_human/],
    [{ ...base, responses: [{ ...item, issuer_schema_id: 11 }] }, /issuer_schema_id must be 1/],
    [{ ...base, responses: [item, item] }, /exactly one/],
    [{ ...base, responses: [] }, /exactly one/],
    [{ ...base, responses: [{ ...item, proof: ["0x1"] }] }, /exactly 5/],
    [{ ...base, responses: [{ ...item, nullifier: "abc" }] }, /0x hex uint256/],
  ];
  for (const [input, pattern] of rejected) {
    assert.throws(() => parseProofOfHumanResult(input), pattern);
  }
});

test("verifyProofOfHuman forwards the result unchanged to /api/v4/verify/{rp_id}", async () => {
  const action = voteActionForRound("1");
  const result = v4Result(action);
  const { fetch, calls } = scriptedFetch(200, JSON.stringify(portalSuccess(action)));
  const verified = await verifyProofOfHuman({
    rpId: RP_ID,
    environment: "production",
    action,
    signal: WALLET,
    idkitResult: result,
    fetch,
  });
  assert.equal(WORLD_ID_VERIFY_URL_BASE, "https://developer.world.org/api/v4/verify");
  assert.deepEqual(calls, [
    { url: `${WORLD_ID_VERIFY_URL_BASE}/${RP_ID}`, body: JSON.stringify(result) },
  ]);
  assert.deepEqual(verified, { action, nullifier: NULLIFIER_DECIMAL });
});

test("verifyProofOfHuman rejects before calling the portal on local mismatches", async () => {
  const action = voteActionForRound("1");
  const common = { rpId: RP_ID, environment: "production" as const, fetch: neverFetch };
  const base = v4Result(action);
  await assert.rejects(
    verifyProofOfHuman({
      ...common,
      action,
      signal: WALLET,
      idkitResult: { ...base, protocol_version: "3.0" },
    }),
    /legacy proofs are rejected/,
  );
  await assert.rejects(
    verifyProofOfHuman({
      ...common,
      action: voteActionForRound("2"),
      signal: WALLET,
      idkitResult: base,
    }),
    /action mismatch/,
  );
  await assert.rejects(
    verifyProofOfHuman({
      ...common,
      action,
      signal: "0x2222222222222222222222222222222222222222",
      idkitResult: base,
    }),
    /signal_hash does not match/,
  );
  await assert.rejects(
    verifyProofOfHuman({
      ...common,
      action,
      signal: WALLET,
      idkitResult: { ...base, environment: "staging" },
    }),
    /environment mismatch/,
  );
});

test("verifyProofOfHuman with signal null requires a proof with no signal", async () => {
  const action = voteActionForRound("1");
  const base = v4Result(action);
  const { signal_hash: _dropped, ...unsigned } = pohItem();
  for (const item of [unsigned, { ...unsigned, signal_hash: "0x0" }]) {
    const { fetch, calls } = scriptedFetch(200, JSON.stringify(portalSuccess(action)));
    await verifyProofOfHuman({
      rpId: RP_ID,
      environment: "production",
      action,
      signal: null,
      idkitResult: { ...base, responses: [item] },
      fetch,
    });
    assert.equal(calls.length, 1);
  }
  await assert.rejects(
    verifyProofOfHuman({
      rpId: RP_ID,
      environment: "production",
      action,
      signal: null,
      idkitResult: base,
      fetch: neverFetch,
    }),
    /carries a signal/,
  );
  await assert.rejects(
    verifyProofOfHuman({
      rpId: RP_ID,
      environment: "production",
      action,
      signal: WALLET,
      idkitResult: { ...base, responses: [unsigned] },
      fetch: neverFetch,
    }),
    /signal_hash does not match/,
  );
});

test("verifyProofOfHuman fails closed on every portal rejection", async () => {
  const action = voteActionForRound("1");
  const ok = portalSuccess(action);
  const cases: [string, number, string, RegExp][] = [
    [
      "HTTP 400 invalid proof",
      400,
      JSON.stringify({ success: false, code: "all_verifications_failed", detail: "x" }),
      /HTTP 400/,
    ],
    [
      "HTTP 404 unknown rp",
      404,
      JSON.stringify({ success: false, code: "x", detail: "x" }),
      /HTTP 404/,
    ],
    ["200 non-JSON", 200, "<html>", /non-JSON/],
    ["200 success false", 200, JSON.stringify({ ...ok, success: false }), /did not report success/],
    [
      "200 staging environment",
      200,
      JSON.stringify({ ...ok, environment: "staging" }),
      /environment mismatch/,
    ],
    ["200 wrong action", 200, JSON.stringify({ ...ok, action: "other" }), /action mismatch/],
    [
      "200 other nullifier",
      200,
      JSON.stringify({ ...ok, nullifier: "0x01" }),
      /different nullifier/,
    ],
    [
      "200 no results",
      200,
      JSON.stringify({ ...ok, results: undefined }),
      /did not report success/,
    ],
    [
      "200 PoH result failed",
      200,
      JSON.stringify({ ...ok, results: [{ identifier: "proof_of_human", success: false }] }),
      /did not pass exactly one/,
    ],
    [
      "200 PoH result other nullifier",
      200,
      JSON.stringify({
        ...ok,
        results: [{ identifier: "proof_of_human", success: true, nullifier: "0x02" }],
      }),
      /result nullifier does not match/,
    ],
  ];
  for (const [name, status, body, pattern] of cases) {
    const { fetch, calls } = scriptedFetch(status, body);
    await assert.rejects(
      verifyProofOfHuman({
        rpId: RP_ID,
        environment: "production",
        action,
        signal: WALLET,
        idkitResult: v4Result(action),
        fetch,
      }),
      pattern,
      name,
    );
    assert.equal(calls.length, 1, name);
  }
});

test("claimHumanAction verifies with the portal, stores the nullifier once, and rejects reuse", async () => {
  const store = new MemoryNullifierStore();
  const action = voteActionForRound("5");
  const { fetch, calls } = scriptedFetch(200, JSON.stringify(portalSuccess(action)));
  const claim = () =>
    claimHumanAction({
      action,
      signal: WALLET,
      idkitResult: v4Result(action),
      nullifierStore: store,
      fetch,
      env: testEnv(),
    });

  const verified = await claim();
  assert.equal(calls.length, 1);
  assert.equal(verified.nullifier, NULLIFIER_DECIMAL);
  assert.equal(await store.has(action, NULLIFIER_DECIMAL), true);

  await assert.rejects(claim(), NullifierAlreadyUsedError);
  assert.equal(calls.length, 1);

  const nextRound = voteActionForRound("6");
  await claimHumanAction({
    action: nextRound,
    signal: WALLET,
    idkitResult: v4Result(nextRound),
    nullifierStore: store,
    fetch: scriptedFetch(200, JSON.stringify(portalSuccess(nextRound))).fetch,
    env: testEnv(),
  });
  assert.equal(await store.has(nextRound, NULLIFIER_DECIMAL), true);
});

test("claimHumanAction stores nothing when the portal rejects the proof", async () => {
  const store = new MemoryNullifierStore();
  const action = stakeActionForBattle("9");
  const { fetch, calls } = scriptedFetch(
    400,
    JSON.stringify({ success: false, code: "all_verifications_failed", detail: "x" }),
  );
  await assert.rejects(
    claimHumanAction({
      action,
      signal: WALLET,
      idkitResult: v4Result(action),
      nullifierStore: store,
      fetch,
      env: testEnv(),
    }),
    /World ID verify failed/,
  );
  assert.equal(calls.length, 1);
  assert.equal(await store.has(action, NULLIFIER_DECIMAL), false);
});

test("claimHumanAction refuses to run without World ID env", async () => {
  const action = voteActionForRound("1");
  await assert.rejects(
    claimHumanAction({
      action,
      signal: WALLET,
      idkitResult: v4Result(action),
      nullifierStore: new MemoryNullifierStore(),
      fetch: neverFetch,
      env: { ...testEnv(), WORLD_ID_RP_ID: undefined },
    }),
    /WORLD_ID_RP_ID is required/,
  );
});
