import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import { MemoryBattleQueueStore } from "@horror-tube/fight/battle-queue";

import { MemoryRoundStore } from "../src/db/rounds.js";
import { GameLoop } from "../src/game/loop.js";
import { issueSession } from "../src/human-session.js";
import { createGameServer, listenGameServer } from "../src/server.js";

const PEPPER = "session-test-pepper";

const config = {
  bettingCloseAfterVideoStartSeconds: 5,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

function testLoop(roundStore = new MemoryRoundStore()): GameLoop {
  return new GameLoop({
    config,
    ensLabels: ["jason", "freddy", "chucky"],
    ensStatuses: ["alive", "alive", "alive"],
    randomInt: () => 0,
    battleQueueStore: new MemoryBattleQueueStore(),
    roundStore,
    chainWritePorts: {
      async writeWinnerInjuries() {
        throw new Error("session tests must not write injuries.");
      },
      async writeLoserStatusDead() {
        throw new Error("session tests must not write status.");
      },
      async settleBattle(_battleId, _side) {
        throw new Error("session tests must not settle a battle.");
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
      poolIdFor(battleId) {
        return `0xpool-${battleId}`;
      },
      async openBattle() {
        return "battle-session-1";
      },
      async cancelBattle() {},
      async closeBetting() {},
      async settle() {
        return "digest";
      },
      async readPoolTotals() {
        return [0n, 0n];
      },
    },
    fightJob: async () => new Promise(() => {}),
  });
}

describe("POST /playback-start session", () => {
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

  it("POST /playback-start needs a session and is refused outside the bet phase", async () => {
    const game = testLoop();
    const base = await listen(game, PEPPER);
    {
      const res = await fetch(`${base}/playback-start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ battleId: "x" }),
      });
      assert.equal(res.status, 401);
    }
    const res = await fetch(`${base}/playback-start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueSession("111", PEPPER)}`,
      },
      body: JSON.stringify({ battleId: "x" }),
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.match(body.error, /playback start is only accepted in the bet phase/u);
  });

  it("rejects when WALLET_SECRET_PEPPER is missing", async () => {
    const base = await listen(testLoop(), undefined);
    const res = await fetch(`${base}/playback-start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueSession("111", PEPPER)}`,
      },
      body: JSON.stringify({ battleId: "x" }),
    });
    assert.equal(res.status, 500);
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.match(body.error, /WALLET_SECRET_PEPPER/u);
  });
});
