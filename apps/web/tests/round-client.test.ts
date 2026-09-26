import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { formatPoolOdds } from "../odds.ts";
import { fetchRoundState, postVote, type ServerRoundState } from "../round-client.ts";
import { WALLET_SESSION_KEY, type SessionStore } from "../wallet.ts";

function memoryStore(session: string | null = null): SessionStore {
  const items = new Map<string, string>();
  if (session !== null) items.set(WALLET_SESSION_KEY, session);
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe("formatPoolOdds", () => {
  it("returns the numeric ratio when both sides have stake", () => {
    assert.equal(formatPoolOdds([10, 30], 0), "4.00");
    assert.equal(formatPoolOdds([10, 30], 1), "1.33");
  });

  it("does not divide when either side has no stake", () => {
    assert.equal(formatPoolOdds([0, 5], 0), "no stake");
    assert.equal(formatPoolOdds([0, 5], 1), "no stake");
    assert.equal(formatPoolOdds([7, 0], 0), "no stake");
    assert.equal(formatPoolOdds([0, 0], 0), "no stake");
  });

  it("nets feeBps off the opposing stake", () => {
    assert.equal(formatPoolOdds([100, 100], 0, 200), "1.98");
  });
});

const baseState: ServerRoundState = {
  round: 1,
  phase: "vote",
  endsAt: null,
  champion: null,
  slots: 2,
  voters: 1,
  quorum: 2,
  votes: { 0: 1, 1: 1 },
  tally: null,
  fighters: null,
  battleId: null,
  poolId: null,
  pool: [0, 0],
  winner: null,
  videoUrl: null,
  videoStartedAt: null,
  bettingClosesAt: null,
  frameUrl: null,
  error: null,
  chars: [],
};

function serveJson(t: TestContext, body: Partial<ServerRoundState>): void {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("postVote", () => {
  it("refuses before fetch when the World ID session is missing", async () => {
    await assert.rejects(
      () => postVote([0, 1], memoryStore(null)),
      /World ID session is required/u,
    );
  });

  it("sends the stored session as Authorization Bearer", async (t) => {
    const store = memoryStore("signed-session");
    const fakeFetch: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer signed-session");
      assert.equal(init?.body, JSON.stringify({ picks: [0, 1] }));
      return new Response(JSON.stringify({ ok: true, state: baseState }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    t.mock.method(globalThis, "fetch", fakeFetch);
    const got = await postVote([0, 1], store);
    assert.equal(got.voters, 1);
  });
});

describe("RoundState client contract", () => {
  it("accepts countdown phase and slots 1|2 from the server", async (t) => {
    serveJson(t, {
      ...baseState,
      round: 2,
      phase: "countdown",
      endsAt: Date.now() + 15_000,
      champion: 0,
      slots: 1,
      voters: 2,
      votes: { 1: 2, 2: 1 },
      chars: [
        { id: 0, alive: true, kills: 1, damage: 10 },
        { id: 1, alive: true, kills: 0, damage: 0 },
      ],
    });
    const state = await fetchRoundState();
    assert.equal(state.phase, "countdown");
    assert.equal(state.slots, 1);
    assert.equal(state.champion, 0);
    assert.equal(state.votes[1], 2);
    assert.equal(state.chars[0]?.damage, 10);
  });

  it("rejects a RoundState that is missing a field", async (t) => {
    const { pool: _pool, ...withoutPool } = baseState;
    serveJson(t, withoutPool);
    await assert.rejects(fetchRoundState(), /GET \/round sent an invalid RoundState:.*pool/su);
  });
});
