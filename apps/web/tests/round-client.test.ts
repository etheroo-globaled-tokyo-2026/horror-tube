import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { formatPoolOdds } from "../odds.ts";
import {
  SessionPostError,
  fetchRoundState,
  postPlaybackStart,
  postStart,
  postNextFighter,
  postVote,
  type ServerRoundState,
} from "../round-client.ts";
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
  phase: "waiting",
  endsAt: null,
  champion: null,
  voters: 0,
  quorum: 2,
  votes: [0, 0],
  tally: null,
  fighters: null,
  selectable: [],
  battleId: null,
  poolId: null,
  pool: [0, 0],
  winner: null,
  videoUrl: null,
  videoStartedAt: null,
  bettingClosesAt: null,
  frameUrl: null,
  error: null,
  bots: [],
  chars: [],
};

function respond(t: TestContext, status: number, json: string, seen: RequestInit[] = []): void {
  const fakeFetch: typeof fetch = async (_input, init) => {
    if (init !== undefined) seen.push(init);
    return new Response(json, {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  t.mock.method(globalThis, "fetch", fakeFetch);
}

describe("session posts", () => {
  it("refuses before fetch when the World ID session is missing", async () => {
    await assert.rejects(() => postVote(0, memoryStore(null)), /World ID session is required/u);
    await assert.rejects(() => postStart(0, memoryStore(null)), /World ID session is required/u);
    await assert.rejects(() => postNextFighter(1, memoryStore(null)), /World ID session is required/u);
    await assert.rejects(
      () => postPlaybackStart("battle-1", memoryStore(null)),
      /World ID session is required/u,
    );
  });

  it("sends the stored session as Authorization Bearer and returns the state", async (t) => {
    const seen: RequestInit[] = [];
    respond(
      t,
      200,
      JSON.stringify({ ok: true, state: { ...baseState, phase: "bet", fighters: [0, 1] } }),
      seen,
    );
    const got = await postStart(0, memoryStore("signed-session"));
    assert.equal(got.phase, "bet");
    assert.equal(new Headers(seen[0]?.headers).get("authorization"), "Bearer signed-session");
  });

  it("surfaces the server's status, code, and error when a start is refused", async (t) => {
    respond(
      t,
      409,
      JSON.stringify({
        ok: false,
        error: "start refused: a bout is already open (phase=bet).",
        code: "bout_open",
      }),
    );
    await assert.rejects(
      () => postStart(0, memoryStore("signed-session")),
      (cause: unknown) =>
        cause instanceof SessionPostError &&
        cause.status === 409 &&
        cause.code === "bout_open" &&
        /already open/u.test(cause.message),
    );
  });
});

describe("RoundState client contract", () => {
  it("accepts the waiting phase a fresh server boots in", async (t) => {
    respond(t, 200, JSON.stringify(baseState));
    assert.equal((await fetchRoundState()).phase, "waiting");
  });

  it("accepts a countdown with a per-side tally and the server's character labels", async (t) => {
    respond(
      t,
      200,
      JSON.stringify({
        ...baseState,
        round: 2,
        phase: "countdown",
        endsAt: 15_000,
        champion: 0,
        voters: 2,
        quorum: 2,
        votes: [2, 1],
        fighters: [0, 1],
        chars: [
          { id: 0, label: "chucky", alive: true, kills: 1, damage: 10 },
          { id: 1, label: "count", alive: true, kills: 0, damage: 0 },
        ],
      }),
    );
    const state = await fetchRoundState();
    assert.equal(state.phase, "countdown");
    assert.equal(state.votes[0], 2);
    assert.equal(state.chars[0]?.label, "chucky");
    assert.equal(state.chars[0]?.damage, 10);
  });

  it("rejects a RoundState that is missing a field", async (t) => {
    const { pool: _pool, ...withoutPool } = baseState;
    respond(t, 200, JSON.stringify(withoutPool));
    await assert.rejects(fetchRoundState(), /GET \/round sent an invalid RoundState:.*pool/su);
  });
});
