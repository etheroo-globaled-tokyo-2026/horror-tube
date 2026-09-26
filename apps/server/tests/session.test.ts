import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MemoryBattleQueueStore } from "@horror-tube/fight/battle-queue";
import * as v from "valibot";

import { MemoryRoundStore } from "../src/db/rounds.js";
import { GameLoop } from "../src/game/loop.js";
import type { PairingRunner } from "../src/pairing-job.js";
import { issueSession } from "../src/human-session.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import { baseUrl } from "./base-url.js";

const PEPPER = "session-test-pepper";

const StateJson = v.object({
  ok: v.literal(true),
  state: v.object({
    phase: v.string(),
    fighters: v.nullable(v.tuple([v.number(), v.number()])),
    battleId: v.nullable(v.string()),
  }),
});
const ErrorJson = v.object({
  ok: v.literal(false),
  error: v.string(),
  code: v.optional(v.string()),
});

function testLoop(roundStore = new MemoryRoundStore(), opens: string[] = []): GameLoop {
  return new GameLoop({
    config: {
      quorumVotes: 2,
      voteCountdownSeconds: 10,
      bettingCloseAfterVideoStartSeconds: 5,
      videoTimeoutSeconds: 300,
      settleSeconds: 8,
    },
    ensLabels: ["chucky", "freddy", "jason"],
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
      async writeStatusAlive() {
        throw new Error("session tests must not revive a character.");
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
      async openBattle(battleId) {
        opens.push(battleId);
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
    pairing: (async () => ({
      fighterASubname: "chucky",
      fighterBSubname: "freddy",
      rationale: "test pairing",
    })) satisfies PairingRunner,
    houseBots: { chains: [], stakeUnits: 1n },
  });
}

describe("session routes", () => {
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

  async function listen(game: GameLoop, sessionPepper?: string): Promise<string> {
    const server = createGameServer({ port: 0, host: "127.0.0.1", game, sessionPepper });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1", game, sessionPepper });
    return baseUrl(server);
  }

  function post(base: string, path: string, body: string, session?: string): Promise<Response> {
    const headers = new Headers({ "content-type": "application/json" });
    if (session !== undefined) headers.set("authorization", `Bearer ${session}`);
    return fetch(`${base}${path}`, { method: "POST", headers, body });
  }

  it("POST /start needs a waiver session and leaves the game waiting without one", async () => {
    const game = testLoop();
    const base = await listen(game, PEPPER);
    const res = await post(base, "/start", "");
    assert.equal(res.status, 401);
    assert.match(
      v.parse(ErrorJson, await res.json()).error,
      /Authorization Bearer session is required/u,
    );
    assert.equal(game.getState().phase, "waiting");
  });

  it("POST /start opens one bout and refuses a second with 409 bout_open", async () => {
    const opens: string[] = [];
    const game = testLoop(new MemoryRoundStore(), opens);
    const base = await listen(game, PEPPER);
    const session = issueSession("111", PEPPER);

    const first = await post(base, "/start", JSON.stringify({ fighter: 0 }), session);
    assert.equal(first.status, 200);
    const started = v.parse(StateJson, await first.json()).state;
    assert.equal(started.phase, "vote");
    assert.deepEqual(started.fighters, [0, 1]);
    assert.equal(started.battleId, null);

    const second = await post(
      base,
      "/start",
      JSON.stringify({ fighter: 0 }),
      issueSession("222", PEPPER),
    );
    assert.equal(second.status, 409);
    const refused = v.parse(ErrorJson, await second.json());
    assert.equal(refused.code, "bout_open");
    assert.match(refused.error, /start refused: a bout is already open \(phase=vote/u);
    assert.deepEqual(opens, []);
  });

  it("POST /start answers 500 start_failed naming the failure and stays waiting", async () => {
    const roundStore = new MemoryRoundStore();
    roundStore.startSeason = async () => {
      throw new Error("INSERT INTO seasons failed: disk full");
    };
    const game = testLoop(roundStore);
    const base = await listen(game, PEPPER);
    const res = await post(
      base,
      "/start",
      JSON.stringify({ fighter: 0 }),
      issueSession("111", PEPPER),
    );
    assert.equal(res.status, 500);
    const body = v.parse(ErrorJson, await res.json());
    assert.equal(body.code, "start_failed");
    assert.match(body.error, /disk full/u);
    assert.equal(game.getState().phase, "waiting");
  });

  it("POST /playback-start needs a session and is refused outside the bet phase", async () => {
    const base = await listen(testLoop(), PEPPER);
    const anonymous = await post(base, "/playback-start", JSON.stringify({ battleId: "x" }));
    assert.equal(anonymous.status, 401);
    const res = await post(
      base,
      "/playback-start",
      JSON.stringify({ battleId: "x" }),
      issueSession("111", PEPPER),
    );
    assert.equal(res.status, 409);
    assert.match(
      v.parse(ErrorJson, await res.json()).error,
      /playback start is only accepted in the bet phase/u,
    );
  });

  it("session routes answer 500 when WALLET_SECRET_PEPPER is missing", async () => {
    const base = await listen(testLoop(), undefined);
    for (const path of ["/start", "/playback-start"]) {
      const res = await post(
        base,
        path,
        JSON.stringify({ battleId: "x" }),
        issueSession("111", PEPPER),
      );
      assert.equal(res.status, 500, path);
      assert.match(v.parse(ErrorJson, await res.json()).error, /WALLET_SECRET_PEPPER/u);
    }
  });
});
