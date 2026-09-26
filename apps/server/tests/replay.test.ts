import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import {
  MemoryBattleQueueStore,
  type BattleQueueInsert,
} from "@horror-tube/fight/battle-queue";
import * as v from "valibot";

import { MemoryRoundStore } from "../src/db/rounds.js";
import { GameLoop } from "../src/game/loop.js";
import type { PairingRunner } from "../src/pairing-job.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import { baseUrl } from "./base-url.js";

const NO_HOUSE_BOTS = { chains: [], stakeUnits: 1n };

const ReplayOk = v.object({ videoUrl: v.string() });
const ReplayErr = v.object({ ok: v.literal(false), error: v.string() });

const config = {
  quorumVotes: 1,
  voteCountdownSeconds: 1,
  bettingCloseAfterVideoStartSeconds: 5,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

function agentInsert(overrides: Partial<BattleQueueInsert> = {}): BattleQueueInsert {
  return {
    id: "replay-queue-1",
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

function testLoop(
  store: MemoryBattleQueueStore,
  now: () => number,
): GameLoop {
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
      async openBattle(battleId) {
        return `0xpool-${battleId}`;
      },
      async cancelBattle() {},
      async closeBetting() {},
      async settle() {},
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

describe("GET /replay", () => {
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

  it("returns 404 when no fight video is stored", async () => {
    let clock = 0;
    const base = await listen(testLoop(new MemoryBattleQueueStore(), () => clock));
    const res = await fetch(`${base}/replay`);
    assert.equal(res.status, 404);
    const body = v.parse(ReplayErr, await res.json());
    assert.match(body.error, /no fight video is stored/u);
  });

  it("returns the latest stored Spaces CDN URL; a newer video wins", async () => {
    const store = new MemoryBattleQueueStore();
    let clock = 0;
    const game = testLoop(store, () => clock);
    const base = await listen(game);

    await game.start(0);
    const fighters = game.getState().fighters;
    assert.ok(fighters);
    await game.voteWithNullifier("voter-1", fighters[0]);
    clock = 1_000;
    await game.tick(clock);
    assert.equal(game.getState().phase, "bet");
    const battleId = game.getState().battleId;
    assert.ok(battleId);

    await game.attachAgentResult(agentInsert({ id: "bout-1", battleId }));
    await game.setVideoReady(
      "https://cdn.example/videos/first.mp4",
      1,
      "https://cdn.example/frames/seed.jpg",
    );

    const first = v.parse(ReplayOk, await (await fetch(`${base}/replay`)).json());
    assert.equal(first.videoUrl, "https://cdn.example/videos/first.mp4");

    await store.save({
      ...(await store.get("bout-1"))!,
      id: "bout-2",
      battleId: "other-battle",
    });
    await store.setVideoUrl("bout-2", "https://cdn.example/videos/second.mp4");

    const second = v.parse(ReplayOk, await (await fetch(`${base}/replay`)).json());
    assert.equal(second.videoUrl, "https://cdn.example/videos/second.mp4");
  });

  it("returns 500 naming battle_results when the store read fails", async () => {
    class FailingReadStore extends MemoryBattleQueueStore {
      override async getLatestVideoUrl(): Promise<string | null> {
        throw new Error("connection reset by peer");
      }
    }
    const base = await listen(testLoop(new FailingReadStore(), () => 0));
    const res = await fetch(`${base}/replay`);
    assert.equal(res.status, 500);
    const body = v.parse(ReplayErr, await res.json());
    assert.match(body.error, /battle_results.*connection reset by peer/u);
  });
});
