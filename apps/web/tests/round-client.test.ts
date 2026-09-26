import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPoolOdds } from "../odds.ts";
import { postPlaybackStart, type ServerRoundState } from "../round-client.ts";
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

describe("postPlaybackStart", () => {
  it("refuses before fetch when the World ID session is missing", async () => {
    await assert.rejects(
      () => postPlaybackStart("battle-1", memoryStore(null)),
      /World ID session is required/u,
    );
  });

  it("sends the stored session as Authorization Bearer", async () => {
    const store = memoryStore("signed-session");
    const state: ServerRoundState = {
      round: 1,
      phase: "bet",
      endsAt: null,
      champion: null,
      fighters: [0, 1],
      battleId: "battle-1",
      poolId: "0xpool",
      pool: [0, 0],
      winner: null,
      videoUrl: "https://cdn.example/v.mp4",
      videoStartedAt: 1_000,
      bettingClosesAt: 6_000,
      frameUrl: null,
      error: null,
      chars: [],
    };
    const prev = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer signed-session");
      assert.equal(init?.body, JSON.stringify({ battleId: "battle-1" }));
      return new Response(JSON.stringify({ ok: true, state }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const got = await postPlaybackStart("battle-1", store);
      assert.equal(got.bettingClosesAt, 6_000);
    } finally {
      globalThis.fetch = prev;
    }
  });
});

describe("RoundState client contract", () => {
  it("accepts bet|fight|settle|over phases from the server", () => {
    const state: ServerRoundState = {
      round: 2,
      phase: "bet",
      endsAt: null,
      champion: 0,
      fighters: [0, 1],
      battleId: "battle-2",
      poolId: "0xpool",
      pool: [0, 0],
      winner: null,
      videoUrl: null,
      videoStartedAt: null,
      bettingClosesAt: null,
      frameUrl: null,
      error: null,
      chars: [
        { id: 0, alive: true, kills: 1, damage: 10 },
        { id: 1, alive: true, kills: 0, damage: 0 },
      ],
    };
    assert.equal(state.phase, "bet");
    assert.equal(state.champion, 0);
    assert.deepEqual(state.fighters, [0, 1]);
    assert.equal(state.videoUrl, null);
  });
});
