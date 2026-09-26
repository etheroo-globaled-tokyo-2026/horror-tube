import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { MemoryBattleQueueStore, type BattleQueueInsert } from "@horror-tube/fight/battle-queue";
import * as v from "valibot";

import { MemoryRoundStore } from "../src/db/rounds.js";
import { GameLoop } from "../src/game/loop.js";
import type { PairingRunner } from "../src/pairing-job.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import { baseUrl } from "./base-url.js";

const NO_HOUSE_BOTS = { chains: [], stakeUnits: 1n };

const TapeSchema = v.object({
  battleId: v.string(),
  fighters: v.tuple([v.string(), v.string()]),
  winner: v.string(),
  injuries: v.array(v.string()),
  rationale: v.string(),
  videoUrl: v.string(),
  recordedAt: v.number(),
  statusTx: v.nullable(v.string()),
});
const TapesOk = v.object({ tapes: v.array(TapeSchema) });
const TapesErr = v.object({ ok: v.literal(false), error: v.string() });

const config = {
  quorumVotes: 2,
  voteCountdownSeconds: 3,
  bettingWindowSeconds: 5,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

function agentInsert(overrides: Partial<BattleQueueInsert> = {}): BattleQueueInsert {
  return {
    id: "tapes-queue-1",
    battleId: "will-be-replaced",
    fighterASubname: "jason",
    fighterBSubname: "freddy",
    shots: [
      {
        time_range: "0-2",
        characters: "jason, freddy",
        action: "clash",
        camera: "wide",
        style: "horror",
      },
    ],
    ensLines: ["freddy|status=dead", "jason|injuries=[]"],
    rationale: "jason wins",
    winnerSubname: "jason",
    loserSubname: "freddy",
    winnerInjuries: [],
    ...overrides,
  };
}

function fightJobThatNeverFinishes(): Promise<never> {
  return new Promise(() => {});
}

function testLoop(store: MemoryBattleQueueStore, now: () => number): GameLoop {
  return new GameLoop({
    houseBots: NO_HOUSE_BOTS,
    config,
    ensLabels: ["jason", "freddy", "chucky"],
    ensStatuses: ["alive", "alive", "alive"],
    now,
    randomInt: () => 0,
    battleQueueStore: store,
    roundStore: new MemoryRoundStore(),
    chainWritePorts: {
      async writeWinnerInjuries() {
        return "0xinj";
      },
      async writeLoserStatusDead() {
        return "0xstat";
      },
      async writeStatusAlive() {
        return "0xalive";
      },
      async settleBattle() {
        return "0xsettle";
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
      async openBattle() {},
      async cancelBattle() {},
      async closeBetting() {},
      async settle() {
        return "digest";
      },
      async readPoolTotals() {
        return [0n, 0n];
      },
    },
    fightJob: fightJobThatNeverFinishes,
    pairing: (async () => ({
      fighterASubname: "jason",
      fighterBSubname: "freddy",
      rationale: "test pairing",
    })) satisfies PairingRunner,
  });
}

describe("GET /tapes", () => {
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

  async function listen(game: GameLoop) {
    const server = createGameServer({
      port: 0,
      host: "127.0.0.1",
      game,
    });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1", game });
    return baseUrl(server);
  }

  it("returns an empty list, as a normal 200, when nothing is recorded", async () => {
    const base = await listen(testLoop(new MemoryBattleQueueStore(), () => 0));
    const res = await fetch(`${base}/tapes`);
    assert.equal(res.status, 200);
    const body = v.parse(TapesOk, await res.json());
    assert.deepEqual(body.tapes, []);
  });

  it("hides the live bout's tape while betting is open, and lists it once it is no longer live", async () => {
    const store = new MemoryBattleQueueStore();
    let clock = 0;
    const game = testLoop(store, () => clock);
    const base = await listen(game);

    await game.start(0);
    assert.equal(game.getState().phase, "bet");
    const liveBattleId = game.getState().battleId;
    assert.ok(liveBattleId);

    await game.attachAgentResult(agentInsert({ id: "bout-live", battleId: liveBattleId }));
    await game.setVideoReady(
      "https://cdn.example/videos/live.mp4",
      1,
      "https://cdn.example/frames/live.jpg",
    );

    const storeAlreadyHasAVideoReadyRowForTheLiveBattle = await store.listRecorded();
    assert.equal(storeAlreadyHasAVideoReadyRowForTheLiveBattle.length, 1);
    assert.equal(storeAlreadyHasAVideoReadyRowForTheLiveBattle[0]?.battleId, liveBattleId);

    const whileLive = v.parse(TapesOk, await (await fetch(`${base}/tapes`)).json());
    assert.deepEqual(whileLive.tapes, []);

    const finishedBoutThatIsNotLive = agentInsert({
      id: "bout-finished",
      battleId: "finished-battle",
    });
    await store.save({
      ...finishedBoutThatIsNotLive,
      bettingClosed: true,
      playbackFinished: true,
      videoStartedAt: null,
      bettingClosesAt: null,
      injuriesTxHash: "0xinj",
      statusTxHash: "0xstat",
      settlementTxHash: "0xsettle",
    });
    await store.setVideoUrl("bout-finished", "https://cdn.example/videos/finished.mp4");

    const afterFinished = v.parse(TapesOk, await (await fetch(`${base}/tapes`)).json());
    assert.equal(afterFinished.tapes.length, 1);
    const tape = afterFinished.tapes[0];
    assert.equal(tape?.battleId, "finished-battle");
    assert.deepEqual(tape?.fighters, ["jason", "freddy"]);
    assert.equal(tape?.winner, "jason");
    assert.equal(tape?.videoUrl, "https://cdn.example/videos/finished.mp4");
    assert.equal(tape?.statusTx, "0xstat");
  });

  it("returns 500 naming battle_results when the store read fails", async () => {
    class FailingReadStore extends MemoryBattleQueueStore {
      override async listRecorded(): ReturnType<MemoryBattleQueueStore["listRecorded"]> {
        throw new Error("connection reset by peer");
      }
    }
    const base = await listen(testLoop(new FailingReadStore(), () => 0));
    const res = await fetch(`${base}/tapes`);
    assert.equal(res.status, 500);
    const body = v.parse(TapesErr, await res.json());
    assert.match(body.error, /battle_results.*connection reset by peer/u);
  });
});
