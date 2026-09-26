import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MemoryBattleQueueStore } from "@horror-tube/fight/battle-queue";
import * as v from "valibot";

import { MemoryRoundStore } from "../src/db/rounds.js";
import { GameLoop } from "../src/game/loop.js";
import { issueSession } from "../src/human-session.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import { baseUrl } from "./base-url.js";

const NO_HOUSE_BOTS = { chains: [], stakeUnits: 1n };
const PEPPER = "vote-test-pepper";
const NULLIFIER = "12345678901234567890";

const StateJson = v.object({ ok: v.boolean(), state: v.object({ voters: v.number() }) });
const ErrorJson = v.object({ ok: v.boolean(), error: v.string() });

const config = {
  quorumVotes: 2,
  voteCountdownSeconds: 15,
  bettingCloseAfterVideoStartSeconds: 5,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

function testLoop(roundStore = new MemoryRoundStore()): GameLoop {
  return new GameLoop({
    houseBots: NO_HOUSE_BOTS,
    config,
    ensLabels: ["jason", "freddy", "chucky"],
    ensStatuses: ["alive", "alive", "alive"],
    randomInt: (max) => {
      throw new Error(`randomInt unused in vote tests. max=${String(max)}`);
    },
    battleQueueStore: new MemoryBattleQueueStore(),
    roundStore,
    chainWritePorts: {
      async writeWinnerInjuries() {
        throw new Error("vote tests must not write injuries.");
      },
      async writeLoserStatusDead() {
        throw new Error("vote tests must not write status.");
      },
      async settleBattle(_battleId, _side) {
        throw new Error("vote tests must not settle a battle.");
      },
    },
    battleBetting: {
      config: {
        network: "testnet",
        grpcUrl: "https://example.invalid",
        packageId: "0xpkg",
        houseId: "0xhouse",
        coinType: "0x2::sui::SUI",
      },
      poolIdFor() {
        throw new Error("vote tests must not derive a pool id.");
      },
      async openBattle() {
        throw new Error("vote tests must not open a battle.");
      },
      async cancelBattle() {
        throw new Error("vote tests must not cancel a battle.");
      },
      async closeBetting() {
        throw new Error("vote tests must not close betting.");
      },
      async settle() {
        throw new Error("vote tests must not settle a pool.");
      },
      async readPoolTotals() {
        throw new Error("vote tests must not read a pool.");
      },
    },
    fightJob: async () => {
      throw new Error("vote tests must not start a fight job.");
    },
  });
}

describe("POST /vote session", () => {
  const servers: ReturnType<typeof createGameServer>[] = [];

  after(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  async function listen(game: GameLoop, sessionPepper?: string) {
    const server = createGameServer({
      port: 0,
      host: "127.0.0.1",
      game,
      sessionPepper,
    });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1", game, sessionPepper });
    return baseUrl(server);
  }

  it("counts a vote from a valid waiver session", async () => {
    const game = testLoop();
    const base = await listen(game, PEPPER);
    const session = issueSession(NULLIFIER, PEPPER);
    const res = await fetch(`${base}/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({ picks: [0, 1] }),
    });
    assert.equal(res.status, 200);
    const body = v.parse(StateJson, await res.json());
    assert.equal(body.ok, true);
    assert.equal(body.state.voters, 1);
    assert.equal(game.getState().voters, 1);
  });

  it("answers 500 naming the round when the vote row cannot be stored", async () => {
    const store = new MemoryRoundStore();
    store.insertVote = async () => {
      throw new Error("too many clients already");
    };
    const game = testLoop(store);
    const base = await listen(game, PEPPER);
    const res = await fetch(`${base}/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueSession(NULLIFIER, PEPPER)}`,
      },
      body: JSON.stringify({ picks: [0, 1] }),
    });
    assert.equal(res.status, 500);
    const body = v.parse(ErrorJson, await res.json());
    assert.match(body.error, /Vote insert failed for round 1 .*too many clients already/u);
    assert.equal(game.getState().voters, 0);
  });

  it("rejects a missing Authorization header", async () => {
    const base = await listen(testLoop(), PEPPER);
    const res = await fetch(`${base}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ picks: [0, 1] }),
    });
    assert.equal(res.status, 401);
    const body = v.parse(ErrorJson, await res.json());
    assert.equal(body.ok, false);
    assert.match(body.error, /Authorization Bearer session is required/u);
  });

  it("rejects a bad session", async () => {
    const base = await listen(testLoop(), PEPPER);
    const res = await fetch(`${base}/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-a-valid-session",
      },
      body: JSON.stringify({ picks: [0, 1] }),
    });
    assert.equal(res.status, 401);
    const body = v.parse(ErrorJson, await res.json());
    assert.equal(body.ok, false);
    assert.match(body.error, /Session is not valid/u);
  });

  it("rejects when WALLET_SECRET_PEPPER is missing", async () => {
    const base = await listen(testLoop(), undefined);
    const res = await fetch(`${base}/vote`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueSession(NULLIFIER, PEPPER)}`,
      },
      body: JSON.stringify({ picks: [0, 1] }),
    });
    assert.equal(res.status, 500);
    const body = v.parse(ErrorJson, await res.json());
    assert.equal(body.ok, false);
    assert.match(body.error, /WALLET_SECRET_PEPPER/u);
  });

  it("POST /playback-start needs a session and is refused outside the bet phase", async () => {
    const base = await listen(testLoop(), PEPPER);
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/playback-start`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ battleId: "battle-1" }),
      });
    assert.equal((await post({})).status, 401);
    const res = await post({ authorization: `Bearer ${issueSession(NULLIFIER, PEPPER)}` });
    assert.equal(res.status, 409);
    const body = v.parse(ErrorJson, await res.json());
    assert.match(body.error, /only accepted in the bet phase\. Current phase: vote/u);
  });

  it("does not accept a client-supplied proof body in place of the session", async () => {
    const game = testLoop();
    const base = await listen(game, PEPPER);
    const res = await fetch(`${base}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        proof: { client: "web", pending: true },
        picks: [0, 1],
      }),
    });
    assert.equal(res.status, 401);
    assert.equal(game.getState().voters, 0);
  });
});
