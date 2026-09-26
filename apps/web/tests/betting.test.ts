import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PoolStatus, payout, type Pool, type Ticket } from "@horror-tube/betting";
import { bcs } from "@mysten/sui/bcs";
import { JsonRpcHTTPTransport, SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import * as v from "valibot";

import { fetchBettingIds, placeBet, tally, toContractIds, winningsDue } from "../betting.ts";
import { formatPoolOdds } from "../odds.ts";
import type { GameWallet } from "../wallet.ts";

const PLAYER = `0x${"11".repeat(32)}`;
const PACKAGE = `0x${"aa".repeat(32)}`;
const HOUSE = `0x${"bb".repeat(32)}`;
const POOL = `0x${"cc".repeat(32)}`;
const OPEN_POOL = `0x${"c0".repeat(32)}`;
const OLD_POOL = `0x${"c1".repeat(32)}`;
const COIN_TYPE = `0x${"ee".repeat(32)}::usdc::USDC`;
const IDS = toContractIds({ packageId: PACKAGE, houseId: HOUSE, coinType: COIN_TYPE, feeBps: 200 });
const DIGEST = "11111111111111111111111111111111";

type Kind = ReturnType<Transaction["getData"]>;
type Outcome = { status: "success" } | { status: "failure"; error: string };
type Reply = { status: number; body: { digest: string } | { error: string } };

const TxBody = v.object({ txKind: v.string() });
const NodeCall = v.variant("method", [
  v.object({
    id: v.number(),
    method: v.literal("sui_getNormalizedMoveFunction"),
    params: v.tuple([v.string(), v.string(), v.string()]),
  }),
  v.object({
    id: v.number(),
    method: v.literal("sui_multiGetObjects"),
    params: v.looseTuple([v.array(v.string())]),
  }),
  v.object({
    id: v.number(),
    method: v.literal("sui_getTransactionBlock"),
    params: v.looseTuple([v.string()]),
  }),
]);

const struct = (address: string, module: string, name: string) => ({
  Struct: { address, module, name, typeArguments: [{ TypeParameter: 0 }] },
});
const BET_PARAMS = [
  { Reference: struct(PACKAGE, "betting", "House") },
  { MutableReference: struct(PACKAGE, "betting", "Pool") },
  "U64",
  struct("0x2", "coin", "Coin"),
  { Reference: struct("0x2", "clock", "Clock") },
  {
    MutableReference: {
      Struct: { address: "0x2", module: "tx_context", name: "TxContext", typeArguments: [] },
    },
  },
];

const json = (status: number, body: string): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

function fakeServer(
  outcome: Outcome = { status: "success" },
  reply: Reply = { status: 200, body: { digest: DIGEST } },
) {
  const posted: { authorization: string | null; kind: Kind }[] = [];
  const node = (call: v.InferOutput<typeof NodeCall>) => {
    if (call.method === "sui_getNormalizedMoveFunction")
      return {
        visibility: "Private",
        isEntry: true,
        typeParameters: [{ abilities: [] }],
        parameters: BET_PARAMS,
        return: [],
      };
    if (call.method === "sui_multiGetObjects")
      return call.params[0].map((objectId) => ({
        data: {
          objectId,
          version: "7",
          digest: DIGEST,
          type: "object",
          owner: { Shared: { initial_shared_version: 3 } },
        },
      }));
    return { digest: call.params[0], effects: { status: outcome } };
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = String(init?.body);
    if (String(input) === "/tx") {
      const { txKind } = v.parse(TxBody, JSON.parse(body));
      posted.push({
        authorization: new Headers(init?.headers).get("authorization"),
        kind: Transaction.fromKind(txKind).getData(),
      });
      return json(reply.status, JSON.stringify(reply.body));
    }
    const call = v.parse(NodeCall, JSON.parse(body));
    return json(200, JSON.stringify({ jsonrpc: "2.0", id: call.id, result: node(call) }));
  };
  const wallet: GameWallet = {
    address: PLAYER,
    session: "signed-session",
    client: new SuiJsonRpcClient({
      network: "testnet",
      transport: new JsonRpcHTTPTransport({ url: "http://sui.test", fetch: fetchImpl }),
    }),
  };
  return { wallet, posted, fetchImpl };
}

describe("fetchBettingIds", () => {
  it("parses GET /betting", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      assert.equal(String(input), "/betting");
      return json(200, JSON.stringify({ ...IDS, network: "testnet", feeBps: 200 }));
    };
    const ids = await fetchBettingIds(fetchImpl);
    assert.equal(ids.feeBps, 200);
    assert.equal(ids.packageId, PACKAGE);
    assert.equal(ids.coinType, COIN_TYPE);
  });

  it("refuses a GET /betting body without a coin type", async () => {
    const fetchImpl: typeof fetch = async () =>
      json(200, JSON.stringify({ packageId: PACKAGE, houseId: HOUSE, feeBps: 200 }));
    await assert.rejects(
      () => fetchBettingIds(fetchImpl),
      /GET \/betting returned bad betting IDs:.*coinType/u,
    );
  });

  it("fails with HTTP status when GET /betting is not ok", async () => {
    const fetchImpl: typeof fetch = async () => new Response("missing", { status: 500 });
    await assert.rejects(() => fetchBettingIds(fetchImpl), /GET \/betting failed: HTTP 500/u);
  });
});

describe("placeBet through /tx", () => {
  it("posts one betting::bet kind for the side and pool with the session", async () => {
    const server = fakeServer();
    assert.equal(await placeBet(server.wallet, IDS, POOL, 1, 30_000n, server.fetchImpl), DIGEST);
    assert.equal(server.posted.length, 1);
    const [only] = server.posted;
    assert.ok(only);
    assert.equal(only.authorization, "Bearer signed-session");
    const bet = only.kind.commands.flatMap((command) =>
      command.MoveCall !== undefined &&
      normalizeSuiAddress(command.MoveCall.package) === PACKAGE &&
      command.MoveCall.function === "bet"
        ? [command.MoveCall]
        : [],
    )[0];
    assert.ok(bet, "expected betting::bet MoveCall");
    assert.deepEqual(bet.typeArguments.map(normalizeStructTag), [normalizeStructTag(COIN_TYPE)]);
    const side = bet.arguments[2];
    assert.ok(side?.$kind === "Input");
    const sideInput = only.kind.inputs[side.Input];
    assert.ok(sideInput?.$kind === "Pure");
    assert.equal(bcs.u64().parse(fromBase64(sideInput.Pure.bytes)), "1");
  });

  it("surfaces /tx errors and does not invent a digest", async () => {
    const server = fakeServer(undefined, { status: 400, body: { error: "tx policy rejected" } });
    await assert.rejects(
      () => placeBet(server.wallet, IDS, POOL, 0, 30_000n, server.fetchImpl),
      /tx policy rejected/u,
    );
  });

  it("rejects with the chain's error when the bet aborts on chain", async () => {
    const server = fakeServer({ status: "failure", error: "MoveAbort EBettingClosed" });
    await assert.rejects(
      () => placeBet(server.wallet, IDS, POOL, 0, 30_000n, server.fetchImpl),
      /EBettingClosed/u,
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

describe("winnings", () => {
  const pool = (id: string, status: number, totals: [bigint, bigint]): Pool => ({
    id,
    houseId: HOUSE,
    battleId: id,
    closesAtMs: 0n,
    feeBps: 200n,
    status,
    winningSide: 0n,
    fee: (totals[1] * 200n) / 10_000n,
    totals,
    pot: totals[0] + totals[1],
  });
  const ticket = (id: string, poolId: string, side: bigint, stake: bigint): Ticket => ({
    id,
    poolId,
    side,
    stake,
  });
  const round = pool(POOL, PoolStatus.settled, [3_000_000n, 1_000_000n]);
  const earlier = pool(OLD_POOL, PoolStatus.settled, [1_000_000n, 1_000_000n]);
  const pending = pool(OPEN_POOL, PoolStatus.open, [5_000_000n, 5_000_000n]);
  const pools = new Map([round, earlier, pending].map((p) => [p.id, p]));
  const won = ticket(`0x${"d1".repeat(32)}`, POOL, 0n, 3_000_000n);
  const lostNow = ticket(`0x${"d2".repeat(32)}`, POOL, 1n, 1_000_000n);
  const lostEarlier = ticket(`0x${"d3".repeat(32)}`, OLD_POOL, 1n, 1_000_000n);
  const open = ticket(`0x${"d4".repeat(32)}`, OPEN_POOL, 0n, 5_000_000n);

  it("sums payouts over finished pools and leaves open pools alone", () => {
    const claim = tally([won, lostEarlier, open], pools, POOL);
    assert.deepEqual(claim.tickets, [won, lostEarlier]);
    assert.equal(claim.units, payout(round, won) + payout(earlier, lostEarlier));
  });

  it("counts lost stake only on the round's pool", () => {
    assert.equal(tally([won, lostEarlier], pools, POOL).lost, 0n);
    assert.equal(tally([lostNow, lostEarlier], pools, POOL).lost, lostNow.stake);
    assert.equal(tally([lostEarlier, open], pools, OPEN_POOL).lost, 0n);
  });

  it("is checked on every phase change and on every settle update", () => {
    assert.equal(winningsDue("fight", "settle"), true);
    assert.equal(winningsDue("settle", "settle"), true);
    assert.equal(winningsDue("settle", "vote"), true);
    assert.equal(winningsDue("bet", "bet"), false);
  });
});
