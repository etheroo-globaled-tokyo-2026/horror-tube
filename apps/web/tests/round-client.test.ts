import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { formatPoolOdds } from "../odds.ts";
import {
  SessionPostError,
  fetchRoundState,
  fetchTapes,
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
  fighters: null,
  selectable: [],
  votes: [],
  voters: 0,
  quorum: 0,
  battleId: null,
  poolId: null,
  pool: [0, 0],
  winner: null,
  videoUrl: null,
  videoStartedAt: null,
  bettingClosesAt: null,
  frameUrl: null,
  error: null,
  bookError: null,
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
  });

  it("sends the stored session as Authorization Bearer and returns the state", async (t) => {
    const seen: RequestInit[] = [];
    respond(
      t,
      200,
      JSON.stringify({ ok: true, state: { ...baseState, voters: 1, votes: [1] } }),
      seen,
    );
    const got = await postVote(0, memoryStore("signed-session"));
    assert.equal(got.voters, 1);
    assert.equal(new Headers(seen[0]?.headers).get("authorization"), "Bearer signed-session");
  });

  it("surfaces the server's status, code, and error when a vote is refused", async (t) => {
    respond(
      t,
      409,
      JSON.stringify({
        ok: false,
        error: "vote refused: you already voted this poll.",
        code: "already_voted",
      }),
    );
    await assert.rejects(
      () => postVote(0, memoryStore("signed-session")),
      (cause: unknown) =>
        cause instanceof SessionPostError &&
        cause.status === 409 &&
        cause.code === "already_voted" &&
        /already voted/u.test(cause.message),
    );
  });
});

describe("RoundState client contract", () => {
  it("accepts the waiting phase a fresh server boots in", async (t) => {
    respond(t, 200, JSON.stringify(baseState));
    assert.equal((await fetchRoundState()).phase, "waiting");
  });

  it("rejects a RoundState that is missing a field", async (t) => {
    const { pool: _pool, ...withoutPool } = baseState;
    respond(t, 200, JSON.stringify(withoutPool));
    await assert.rejects(fetchRoundState(), /GET \/round sent an invalid RoundState:.*pool/su);
  });
});

describe("fetchTapes", () => {
  it("returns the recorded bouts from GET /tapes", async (t) => {
    const tape = {
      battleId: "bout-1",
      fighters: ["jason", "freddy"],
      winner: "jason",
      injuries: ["left arm"],
      rationale: "jason wins",
      videoUrl: "https://cdn.example/videos/bout-1.mp4",
      recordedAt: 1,
      statusTx: "0xstat",
    };
    respond(t, 200, JSON.stringify({ tapes: [tape] }));
    assert.deepEqual(await fetchTapes(), [tape]);
  });

  it("surfaces the server's error when the store read fails", async (t) => {
    respond(t, 500, JSON.stringify({ ok: false, error: "Reading battle_results failed: timeout" }));
    await assert.rejects(fetchTapes(), /battle_results failed: timeout/u);
  });
});
