import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import { MemoryBattleQueueStore } from "@horror-tube/fight/battle-queue";

import { GameLoop } from "../src/game/loop.js";
import { issueSession } from "../src/human-session.js";
import { createGameServer, listenGameServer } from "../src/server.js";

const PEPPER = "vote-test-pepper";
const NULLIFIER = "12345678901234567890";

const config = {
  quorumVotes: 2,
  voteCountdownSeconds: 15,
  betMinSeconds: 10,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

function testLoop(): GameLoop {
  return new GameLoop({
    config,
    ensLabels: ["jason", "freddy", "chucky"],
    ensStatuses: ["alive", "alive", "alive"],
    randomInt: (max) => {
      throw new Error(`randomInt unused in vote tests. max=${String(max)}`);
    },
    battleQueueStore: new MemoryBattleQueueStore(),
    chainWritePorts: {
      async writeWinnerInjuries() {
        throw new Error("vote tests must not write injuries.");
      },
      async writeLoserStatusDead() {
        throw new Error("vote tests must not write status.");
      },
      async settleBattle() {
        throw new Error("vote tests must not settle a battle.");
      },
    },
    battleBetting: {
      async minBet() {
        throw new Error("vote tests must not read minBet.");
      },
      async openBattle() {
        throw new Error("vote tests must not open a battle.");
      },
      async placeBet() {
        throw new Error("vote tests must not place a bet.");
      },
      async cancelBattle() {
        throw new Error("vote tests must not cancel a battle.");
      },
    },
    fightJob: async () => {
      throw new Error("vote tests must not start a fight job.");
    },
    skipSettlement: true,
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
    const addr = server.address() as AddressInfo;
    return `http://127.0.0.1:${String(addr.port)}`;
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
    const body = (await res.json()) as { ok: boolean; state: { voters: number } };
    assert.equal(body.ok, true);
    assert.equal(body.state.voters, 1);
    assert.equal(game.getState().voters, 1);
  });

  it("rejects a missing Authorization header", async () => {
    const base = await listen(testLoop(), PEPPER);
    const res = await fetch(`${base}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ picks: [0, 1] }),
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; error: string };
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
    const body = (await res.json()) as { ok: boolean; error: string };
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
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /WALLET_SECRET_PEPPER/u);
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
