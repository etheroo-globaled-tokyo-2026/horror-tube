import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { betTx } from "@horror-tube/betting";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import * as v from "valibot";

import { fetchBettingIds, toContractIds } from "../betting.ts";
import { formatPoolOdds } from "../odds.ts";
import {
  runKind,
  usdcTransfer,
  type GameWallet,
} from "../wallet.ts";

const ADDRESS = `0x${"11".repeat(32)}`;
const PACKAGE = `0x${"aa".repeat(32)}`;
const HOUSE = `0x${"bb".repeat(32)}`;
const POOL = `0x${"cc".repeat(32)}`;
const TO = `0x${"dd".repeat(32)}`;
const COIN_TYPE = `0x${"ee".repeat(32)}::usdc::USDC`;

function fakeWallet(session = "sess"): GameWallet {
  const client = new SuiGrpcClient({ network: "testnet", baseUrl: "http://127.0.0.1:9" });
  mock.method(client, "waitForTransaction", async () => undefined);
  return { address: ADDRESS, session, client };
}

describe("fetchBettingIds", () => {
  it("parses GET /betting", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      assert.equal(String(input), "/betting");
      return new Response(
        JSON.stringify({
          packageId: PACKAGE,
          houseId: HOUSE,
          coinType: COIN_TYPE,
          network: "testnet",
          feeBps: 200,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const ids = await fetchBettingIds(fetchImpl);
    assert.equal(ids.feeBps, 200);
    assert.equal(ids.packageId, PACKAGE);
    assert.equal(ids.coinType, COIN_TYPE);
  });

  it("refuses a GET /betting body without a coin type", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ packageId: PACKAGE, houseId: HOUSE, feeBps: 200 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      () => fetchBettingIds(fetchImpl),
      /GET \/betting returned bad betting IDs:.*coinType/u,
    );
  });

  it("fails with HTTP status when GET /betting is not ok", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("missing", { status: 500 });
    await assert.rejects(() => fetchBettingIds(fetchImpl), /GET \/betting failed: HTTP 500/u);
  });
});

describe("bet kind", () => {
  it("builds a MoveCall to package::betting::bet for the side", () => {
    const ids = toContractIds({
      packageId: PACKAGE,
      houseId: HOUSE,
      coinType: COIN_TYPE,
      feeBps: 200,
    });
    const data = betTx(ids, POOL, 1, 30_000n).getData();
    const calls = data.commands.flatMap((command) =>
      command.MoveCall === undefined ? [] : [command.MoveCall],
    );
    const bet = calls.find(
      (call) =>
        normalizeSuiAddress(call.package) === normalizeSuiAddress(PACKAGE) &&
        call.module === "betting" &&
        call.function === "bet",
    );
    assert.ok(bet, "expected betting::bet MoveCall");
  });
});

describe("runKind /tx", () => {
  it("posts one /tx and returns the digest", async () => {
    const wallet = fakeWallet();
    let posted = false;
    const fetchImpl: typeof fetch = async (input, init) => {
      assert.equal(String(input), "/tx");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer sess");
      const body = v.parse(v.object({ txKind: v.string() }), JSON.parse(String(init?.body)));
      assert.ok(body.txKind.length > 0);
      posted = true;
      return new Response(JSON.stringify({ digest: "0xdigest" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const digest = await runKind(wallet, usdcTransfer(COIN_TYPE, TO, 1_000n), fetchImpl);
    assert.equal(digest, "0xdigest");
    assert.equal(posted, true);
  });

  it("surfaces /tx errors and does not invent a digest", async () => {
    const wallet = fakeWallet();
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "tx policy rejected" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      () => runKind(wallet, usdcTransfer(COIN_TYPE, TO, 1_000n), fetchImpl),
      /tx policy rejected/u,
    );
  });
});

describe("formatPoolOdds with fee", () => {
  it("subtracts feeBps from the losing side", () => {
    assert.equal(formatPoolOdds([100, 100], 0, 200), "1.98");
    assert.equal(formatPoolOdds([100, 100], 1, 200), "1.98");
  });

  it("matches the no-fee ratio when feeBps is 0", () => {
    assert.equal(formatPoolOdds([10, 30], 0, 0), "4.00");
    assert.equal(formatPoolOdds([10, 30], 1, 0), "1.33");
  });
});
