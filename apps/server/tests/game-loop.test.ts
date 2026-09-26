import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MemoryBattleQueueStore,
  type BattleQueueInsert,
  type ChainWritePorts,
} from "@horror-tube/fight/battle-queue";

import type { BattleBettingPorts } from "../src/battle-betting.js";
import type { FightJobRequest, FightJobResult, FightJobRunner } from "../src/fight-job.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
} from "../src/game/config.js";
import { MemoryRoundStore } from "../src/db/rounds.js";
import { GameLoop, StoreWriteError } from "../src/game/loop.js";
import type { RoundState } from "../src/types.js";

const baseConfig = {
  quorumVotes: 2,
  voteCountdownSeconds: 15,
  bettingCloseAfterVideoStartSeconds: 5,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

const labels = ["alpha", "bravo", "charlie", "delta"];

const allAliveStatuses = (ensLabels: string[]): string[] =>
  ensLabels.map(() => "alive");

const pickFirst = () => 0;

function trackingPorts(calls: string[]): ChainWritePorts {
  return {
    async writeWinnerInjuries() {
      calls.push("injuries");
      return "0xinjuries";
    },
    async writeLoserStatusDead() {
      calls.push("status");
      return "0xstatus";
    },
    async settleBattle(battleId, _side) {
      calls.push(`settle:${battleId}`);
      return "0xsettle";
    },
  };
}

function trackingBattleBetting(calls: string[]): BattleBettingPorts {
  return {
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
    async openBattle(battleId, closesAtUnix) {
      calls.push(`open:${battleId},${String(closesAtUnix)}`);
    },
    async cancelBattle(battleId) {
      calls.push(`cancel:${battleId}`);
    },
    async closeBetting(battleId) {
      calls.push(`close:${battleId}`);
    },
    async settle(battleId, side) {
      calls.push(`settle:${battleId}:${String(side)}`);
      return `digest-${battleId}`;
    },
    async readPoolTotals(battleId) {
      calls.push(`read:${battleId}`);
      return [0n, 0n];
    },
  };
}

function agentInsertForAlphaWin(
  overrides: Partial<BattleQueueInsert> = {},
): BattleQueueInsert {
  return sampleAgentInsert({
    fighterASubname: "alpha",
    fighterBSubname: "bravo",
    winnerSubname: "alpha",
    loserSubname: "bravo",
    ensLines: ["bravo|status=dead", 'alpha|injuries=["cut"]'],
    ...overrides,
  });
}

function sampleAgentInsert(
  overrides: Partial<BattleQueueInsert> = {},
): BattleQueueInsert {
  return {
    id: "agent-queue-1",
    battleId: "99",
    fighterASubname: "bravo",
    fighterBSubname: "alpha",
    shots: [
      {
        time_range: "0-4s",
        characters: "bravo and alpha",
        action: "clash",
        camera: "wide",
        style: "gritty",
      },
    ],
    ensLines: [
      "alpha|status=dead",
      'bravo|injuries=["cut"]',
    ],
    rationale: "bravo wins the opening bout",
    winnerSubname: "bravo",
    loserSubname: "alpha",
    winnerInjuries: ["cut"],
    nextOpponentSubname: "charlie",
    ...overrides,
  };
}

function fightJobThatNeverFinishes(): Promise<FightJobResult> {
  return new Promise(() => {});
}

function unusedSettleDeps() {
  const calls: string[] = [];
  const betCalls: string[] = [];
  return {
    battleQueueStore: new MemoryBattleQueueStore(),
    roundStore: new MemoryRoundStore(),
    chainWritePorts: trackingPorts(calls),
    battleBetting: trackingBattleBetting(betCalls),
    fightJob: fightJobThatNeverFinishes,
    calls,
    betCalls,
  };
}

async function startPlayback(loop: GameLoop): Promise<void> {
  const battleId = loop.getState().battleId;
  assert.ok(battleId, "startPlayback needs a live battleId");
  await loop.reportPlaybackStart(battleId);
}

async function flushFightJob(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe("game loop config", () => {
  it("throws and names each timing variable when missing", () => {
    assert.throws(
      () => readGameLoopConfig({}),
      /QUORUM_VOTES is required\. Set it in \.env\. See \.env\.example\./u,
    );
    assert.throws(
      () =>
        readGameLoopConfig({
          QUORUM_VOTES: "2",
        }),
      /VOTE_COUNTDOWN_SECONDS/u,
    );
  });

  it("reads all timings when present", () => {
    const cfg = readGameLoopConfig({
      QUORUM_VOTES: "1",
      VOTE_COUNTDOWN_SECONDS: "15",
      BETTING_CLOSE_AFTER_VIDEO_START_SECONDS: "5",
      VIDEO_TIMEOUT_SECONDS: "300",
      SETTLE_SECONDS: "8",
    });
    assert.deepEqual(cfg, {
      quorumVotes: 1,
      voteCountdownSeconds: 15,
      bettingCloseAfterVideoStartSeconds: 5,
      videoTimeoutSeconds: 300,
      settleSeconds: 8,
    });
  });

  it("refuses a missing, blank, or sub-1 BETTING_CLOSE_AFTER_VIDEO_START_SECONDS", () => {
    const env = {
      QUORUM_VOTES: "1",
      VOTE_COUNTDOWN_SECONDS: "15",
      VIDEO_TIMEOUT_SECONDS: "300",
      SETTLE_SECONDS: "8",
    };
    for (const value of [undefined, " ", "0", "2.5"]) {
      assert.throws(
        () =>
          readGameLoopConfig({ ...env, BETTING_CLOSE_AFTER_VIDEO_START_SECONDS: value }),
        /BETTING_CLOSE_AFTER_VIDEO_START_SECONDS .*See \.env\.example\./u,
        `value ${JSON.stringify(value)}`,
      );
    }
  });

  it("requires ROSTER_ENS_LABELS with at least two labels", () => {
    assert.throws(
      () => readRosterEnsLabels({}),
      /ROSTER_ENS_LABELS/u,
    );
    assert.throws(
      () => readRosterEnsLabels({ ROSTER_ENS_LABELS: "only-one" }),
      /at least two/u,
    );
    assert.deepEqual(
      readRosterEnsLabels({ ROSTER_ENS_LABELS: "zebra,alpha,bravo" }),
      ["alpha", "bravo", "zebra"],
    );
  });
});

describe("GameLoop ENS status", () => {
  it("starts dead labels not alive and rejects votes for them", async () => {
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      ensStatuses: ["alive", "dead", "alive", "alive"],
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    assert.equal(loop.getState().chars[1]?.alive, false);
    await assert.rejects(
      () => loop.voteWithNullifier("dead-vote", [1, 0]),
      /Character 1 is dead and cannot receive votes/u,
    );
  });

  it("treats empty status as alive", () => {
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      ensStatuses: ["", "alive", "alive", "alive"],
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    assert.equal(loop.getState().chars[0]?.alive, true);
  });

  it("throws naming the label and value for unknown status", () => {
    const settle = unusedSettleDeps();
    assert.throws(
      () =>
        new GameLoop({
          config: baseConfig,
          ensLabels: labels,
          ensStatuses: ["alive", "ghost", "alive", "alive"],
          randomInt: pickFirst,
          battleQueueStore: settle.battleQueueStore,
          roundStore: new MemoryRoundStore(),
          chainWritePorts: settle.chainWritePorts,
          battleBetting: settle.battleBetting,
          fightJob: settle.fightJob,
        }),
      /bravo.*ghost|ghost.*bravo/u,
    );
  });

  it("resetFromOver keeps characters that started dead on chain not alive", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const trio = ["alpha", "bravo", "charlie"];
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: trio,
      ensStatuses: ["alive", "alive", "dead"],
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    assert.equal(loop.getState().chars[2]?.alive, false);
    await loop.voteWithNullifier("reset-dead", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "reset-over" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady(
      "https://cdn.example/v.mp4",
      1,
      "https://cdn.example/frames/seed.jpg",
    );
    await startPlayback(loop);
    now += 1_000;
    await loop.tick(now);
    now += 1;
    await loop.tick(now);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "over");
    assert.equal(loop.getState().chars[1]?.alive, false);
    assert.equal(loop.getState().chars[2]?.alive, false);
    loop.resetFromOver();
    assert.equal(loop.getState().phase, "vote");
    assert.equal(loop.getState().chars[0]?.alive, true);
    assert.equal(loop.getState().chars[1]?.alive, true);
    assert.equal(loop.getState().chars[2]?.alive, false);
  });
});

describe("GameLoop phases", () => {
  it("waits in vote until quorum, then countdown, then bet→fight→settle→next bet via rotation", async () => {
    let now = 1_000_000;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 2,
        voteCountdownSeconds: 5,
        bettingCloseAfterVideoStartSeconds: 2,
        settleSeconds: 3,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });

    assert.equal(loop.getState().phase, "vote");
    assert.equal(loop.getState().endsAt, null);
    assert.equal(loop.getState().slots, 2);
    assert.equal(loop.getState().champion, null);

    await loop.voteWithNullifier("n-1", [0, 1]);
    assert.equal(loop.getState().phase, "vote");
    assert.equal(loop.getState().voters, 1);

    await loop.voteWithNullifier("n-2", [1, 2]);
    assert.equal(loop.getState().phase, "countdown");
    assert.equal(loop.getState().endsAt, now + 5_000);

    now += 5_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.ok(loop.getState().fighters);
    assert.deepEqual(loop.getState().fighters, [1, 0]);
    const battleId = loop.getState().battleId;
    assert.ok(battleId, "battleId should be set when bet opens");
    assert.ok(
      settle.betCalls.some((c) => c.startsWith(`open:${battleId},`)),
      `expected openBattle for ${battleId}, got ${JSON.stringify(settle.betCalls)}`,
    );
    assert.equal(loop.getState().poolId, `0xpool-${battleId}`);
    loop.setPool(battleId, `0xpool-${battleId}`, [20000, 0]);
    assert.deepEqual(loop.getState().pool, [20000, 0]);

    await loop.attachAgentResult(sampleAgentInsert());
    loop.setOutcome(0, 3);
    loop.setVideoReady(
      "https://cdn.example/videos/fight1.mp4",
      4_000,
      "https://cdn.example/frames/fight1.jpg",
    );
    assert.equal(loop.getState().phase, "bet");
    await startPlayback(loop);
    now += 2_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "fight");
    assert.ok(
      settle.betCalls.some((c) => c.startsWith("close:")),
      `expected closeBetting, got ${JSON.stringify(settle.betCalls)}`,
    );
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/fight1.mp4");
    assert.equal(
      loop.getState().frameUrl,
      "https://cdn.example/frames/fight1.jpg",
    );

    now += 4_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
    assert.equal(loop.getState().winner, 0);
    assert.equal(loop.getState().champion, 1);
    assert.equal(loop.getState().chars[0]?.alive, false);
    assert.equal(loop.getState().chars[1]?.kills, 1);
    assert.equal(loop.getState().chars[1]?.damage, 3);
    assert.deepEqual(settle.calls, ["injuries", "status", "settle:99"]);

    now += 3_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().round, 2);
    assert.equal(loop.getState().champion, 1);
    assert.deepEqual(loop.getState().fighters, [1, 2]);
    assert.equal(loop.getState().videoUrl, null);
    assert.equal(
      loop.getState().frameUrl,
      "https://cdn.example/frames/fight1.jpg",
    );
  });

  it("fills RoundState.pool from readPoolTotals during bet", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    settle.battleBetting.readPoolTotals = async (battleId) => {
      settle.betCalls.push(`read:${battleId}`);
      return [50_000n, 25_000n];
    };
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 2,
        voteCountdownSeconds: 5,
        bettingCloseAfterVideoStartSeconds: 10,
        settleSeconds: 3,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });

    await loop.voteWithNullifier("n-1", [0, 1]);
    await loop.voteWithNullifier("n-2", [1, 2]);
    now += 5_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.deepEqual(loop.getState().pool, [0, 0]);

    now += 1;
    await loop.tick(now);
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    assert.ok(
      settle.betCalls.includes(`read:${battleId}`),
      `expected pool read, got ${JSON.stringify(settle.betCalls)}`,
    );
    assert.deepEqual(loop.getState().pool, [50_000, 25_000]);

    const readsBefore = settle.betCalls.filter((c) => c.startsWith("read:")).length;
    now += 500;
    await loop.tick(now);
    assert.equal(
      settle.betCalls.filter((c) => c.startsWith("read:")).length,
      readsBefore,
    );
  });

  it("keeps a failed pool settle on the round with the battle id and resumes at settle", async () => {
    let now = 0;
    let settleFails = true;
    const settle = unusedSettleDeps();
    settle.chainWritePorts.settleBattle = async (battleId) => {
      if (settleFails) {
        throw new Error(`Battle ${battleId}: settle on pool 0xpool-${battleId} for side 0 failed. rpc timeout`);
      }
      settle.calls.push(`settle:${battleId}`);
      return "0xsettle";
    };
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("settle-call-1", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "settle-on" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await startPlayback(loop);
    now += 1_000;
    await loop.tick(now);
    now += 1;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
    assert.equal(loop.getState().endsAt, null);
    assert.match(
      loop.getState().error ?? "",
      /settle step settlement failed \(battleId=99\)\. Battle 99: settle on pool 0xpool-99/u,
    );
    const saved = await settle.battleQueueStore.get("settle-on");
    assert.equal(saved?.statusTxHash, "0xstatus");
    assert.equal(saved?.settlementTxHash, null);
    now += 10_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");

    settleFails = false;
    await loop.retrySettle();
    assert.equal(loop.getState().error, null);
    assert.equal((await settle.battleQueueStore.get("settle-on"))?.settlementTxHash, "0xsettle");
    assert.deepEqual(settle.calls, ["injuries", "status", "settle:99"]);
  });

  it("keeps a failed ENS write on the round and resumes it", async () => {
    let now = 0;
    let statusFails = true;
    const calls: string[] = [];
    const store = new MemoryBattleQueueStore();
    const ports: ChainWritePorts = {
      async writeWinnerInjuries() {
        calls.push("injuries");
        return "0xinjuries";
      },
      async writeLoserStatusDead() {
        if (statusFails) {
          throw new Error("rpc timeout on status write");
        }
        calls.push("status");
        return "0xstatus";
      },
      async settleBattle(battleId, _side) {
        calls.push(`settle:${battleId}`);
        return "0xsettle";
      },
    };
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: store,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: ports,
      battleBetting: trackingBattleBetting([]),
      fightJob: fightJobThatNeverFinishes,
    });
    await loop.voteWithNullifier("ens-fail", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "fail-status" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await startPlayback(loop);
    now += 1_000;
    await loop.tick(now);
    now += 1;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
    assert.equal(loop.getState().endsAt, null);
    assert.match(loop.getState().error ?? "", /status write/u);
    const saved = await store.get("fail-status");
    assert.equal(saved?.injuriesTxHash, "0xinjuries");
    assert.equal(saved?.statusTxHash, null);
    assert.equal(saved?.bettingClosed, true);
    assert.equal(saved?.playbackFinished, true);
    now += 10_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
    statusFails = false;
    await loop.retrySettle();
    assert.equal(loop.getState().error, null);
    assert.equal((await store.get("fail-status"))?.statusTxHash, "0xstatus");
    assert.deepEqual(calls, ["injuries", "status", "settle:99"]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
  });

  it("refuses an agent result that names a different winner than the bout", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("mismatch", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(sampleAgentInsert({ id: "wrong-winner" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await startPlayback(loop);
    now += 1_000;
    await loop.tick(now);
    now += 1;
    await assert.rejects(
      () => loop.tick(now),
      /does not match bout winner/u,
    );
    assert.deepEqual(settle.calls, []);
    assert.equal(loop.getState().chars[0]?.alive, true);
    assert.equal(loop.getState().chars[1]?.alive, true);
    assert.equal(loop.getState().error !== null, true);
  });

  it("refuses a playback report when no agent result is attached", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("no-agent", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await assert.rejects(() => startPlayback(loop), /no battle_results row is attached/u);
    now += 60_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().bettingClosesAt, null);
    assert.deepEqual(settle.calls, []);
  });

  it("rejects duplicate nullifier and dead picks in stage 1", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 2,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("same", [0, 1]);
    await assert.rejects(() => loop.voteWithNullifier("same", [2, 3]), /already voted/u);

    const settle2 = unusedSettleDeps();
    const loop2 = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle2.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle2.chainWritePorts,
      battleBetting: settle2.battleBetting,
      fightJob: settle2.fightJob,
    });
    await loop2.voteWithNullifier("uniq-1", [0, 1]);
    now += 1_000;
    await loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    await loop2.attachAgentResult(agentInsertForAlphaWin({ id: "dup-path" }));
    loop2.setOutcome(0, 0);
    loop2.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await startPlayback(loop2);
    now += 1_000;
    await loop2.tick(now);
    now += 1;
    await loop2.tick(now);
    now += 1_000;
    await loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    assert.equal(loop2.getState().champion, 0);
    assert.deepEqual(loop2.getState().fighters, [0, 2]);
    assert.equal(loop2.getState().chars[1]?.alive, false);
    assert.deepEqual(settle2.calls, ["injuries", "status", "settle:99"]);
  });

  it("rejects empty video url", async () => {
    let now = 0;
    const settle2 = unusedSettleDeps();
    const loop2 = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle2.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle2.chainWritePorts,
      battleBetting: settle2.battleBetting,
      fightJob: settle2.fightJob,
    });
    await loop2.voteWithNullifier("y", [0, 1]);
    now += 1_000;
    await loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    assert.throws(() => loop2.setVideoReady("  ", 1000, "https://cdn.example/frames/seed.jpg"), /non-empty/u);
    assert.throws(
      () =>
        loop2.setVideoReady(
          "https://cdn.example/v.mp4",
          1000,
          "  ",
        ),
      /frameUrl must be non-empty/u,
    );
  });

  it("requires randomInt before starting a stage-2 bout", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("z", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "no-random" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await startPlayback(loop);
    now += 1_000;
    await loop.tick(now);
    now += 1;
    await loop.tick(now);
    now += 1_000;
    await assert.rejects(
      () => loop.tick(now),
      /randomInt was not provided/u,
    );
  });

  it("after failVideo cancels the Sui pool and leaves bet for over", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        videoTimeoutSeconds: 5,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("fail-video", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    const battleId = loop.getState().battleId;
    assert.ok(battleId);

    await loop.failVideo("fal render failed: timeout");
    assert.equal(loop.getState().phase, "over");
    assert.equal(loop.getState().error, "fal render failed: timeout");
    assert.deepEqual(loop.getState().pool, [0, 0]);
    assert.ok(
      settle.betCalls.some((c) => c === `cancel:${battleId}`),
      `expected cancelBattle, got ${JSON.stringify(settle.betCalls)}`,
    );
  });

  it("fight job success attaches result and sets video + outcome", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const requests: FightJobRequest[] = [];
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: async (request) => {
        requests.push(request);
        return {
          insert: agentInsertForAlphaWin({
            id: "job-success",
            battleId: request.battleId,
            fighterASubname: request.fighterASubname,
            fighterBSubname: request.fighterBSubname,
          }),
          winnerSide: 0,
          damage: 1,
          videoUrl: "https://cdn.example/videos/job.mp4",
          durationMs: 2_000,
          frameUrl: "https://cdn.example/frames/job.jpg",
        };
      },
    });
    await loop.voteWithNullifier("job-ok", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.deepEqual(loop.getState().fighters, [0, 1]);

    await flushFightJob();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.priorFrameUrl, null);
    assert.deepEqual(requests[0]?.livingSubnames, labels);
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/job.mp4");
    assert.equal(loop.getState().frameUrl, "https://cdn.example/frames/job.jpg");
    assert.equal(loop.getState().error, null);
    now += 60_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet", "a ready video does not close betting");
    await startPlayback(loop);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "fight");
  });

  it("fight job failure runs failVideo and leaves bet for over", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: async () => {
        throw new Error("FAL_KEY is required. Set it in .env. See .env.example.");
      },
    });
    await loop.voteWithNullifier("job-fail", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await flushFightJob();
    assert.equal(loop.getState().phase, "over");
    assert.match(
      loop.getState().error ?? "",
      /Fight job failed: FAL_KEY is required/u,
    );
    assert.ok(
      settle.betCalls.some((c) => c.startsWith("cancel:")),
      `expected cancelBattle, got ${JSON.stringify(settle.betCalls)}`,
    );
  });

  it("a late fight job result is not applied to the next bout", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const requests: FightJobRequest[] = [];
    const pending: Array<(result: FightJobResult) => void> = [];
    const loop = new GameLoop({
      config: { ...baseConfig, quorumVotes: 1, voteCountdownSeconds: 1 },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: (request) => {
        requests.push(request);
        return new Promise((resolve) => pending.push(resolve));
      },
    });
    await loop.voteWithNullifier("late-1", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    const firstBattleId = loop.getState().battleId;
    assert.ok(firstBattleId);
    now += baseConfig.videoTimeoutSeconds * 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "over");

    loop.resetFromOver();
    await loop.voteWithNullifier("late-2", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    await flushFightJob();
    assert.deepEqual(
      requests.map((r) => r.battleId),
      [firstBattleId, loop.getState().battleId],
    );

    pending[0]?.({
      insert: agentInsertForAlphaWin({ id: "late-r1", battleId: firstBattleId }),
      winnerSide: 0,
      damage: 1,
      videoUrl: "https://cdn.example/videos/late.mp4",
      durationMs: 1_000,
      frameUrl: "https://cdn.example/frames/late.jpg",
    });
    await flushFightJob();
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().videoUrl, null);
    assert.equal(loop.getState().error, null);
  });

  it("stage 2 fight job receives priorFrameUrl for image-to-video", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const requests: FightJobRequest[] = [];
    let call = 0;
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: async (request) => {
        call += 1;
        requests.push(request);
        if (call === 1) {
          return {
            insert: agentInsertForAlphaWin({
              id: "job-r1",
              battleId: request.battleId,
              fighterASubname: request.fighterASubname,
              fighterBSubname: request.fighterBSubname,
            }),
            winnerSide: 0,
            damage: 1,
            videoUrl: "https://cdn.example/videos/r1.mp4",
            durationMs: 1_000,
            frameUrl: "https://cdn.example/frames/r1.jpg",
          };
        }
        return {
          insert: {
            id: "job-r2",
            battleId: request.battleId,
            fighterASubname: request.fighterASubname,
            fighterBSubname: request.fighterBSubname,
            shots: [
              {
                time_range: "0-4s",
                characters: "alpha and charlie",
                action: "clash",
                camera: "wide",
                style: "gritty",
              },
            ],
            ensLines: [
              "charlie|status=dead",
              'alpha|injuries=["cut","bruise"]',
            ],
            rationale: "alpha stays on",
            winnerSubname: "alpha",
            loserSubname: "charlie",
            winnerInjuries: ["cut", "bruise"],
            nextOpponentSubname: "delta",
          },
          winnerSide: 0,
          damage: 2,
          videoUrl: "https://cdn.example/videos/r2.mp4",
          durationMs: 1_000,
          frameUrl: "https://cdn.example/frames/r2.jpg",
        };
      },
    });
    await loop.voteWithNullifier("prior-frame", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await flushFightJob();
    assert.equal(requests[0]?.priorFrameUrl, null);
    await startPlayback(loop);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "fight");
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().round, 2);
    await flushFightJob();
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1]?.priorFrameUrl,
      "https://cdn.example/frames/r1.jpg",
    );
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/r2.mp4");
  });

  it("video timeout failVideo also leaves bet and refuses further stakes", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        videoTimeoutSeconds: 2,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("timeout-video", [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    now += 2_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "over");
    assert.match(loop.getState().error ?? "", /VIDEO_TIMEOUT_SECONDS/u);
    assert.ok(settle.betCalls.some((c) => c.startsWith("cancel:")));
  });
});

describe("betting cutoff", () => {
  const VIDEO_MS = 8_000;

  async function readyBout(
    overrides: { battleBetting?: BattleBettingPorts; battleQueueStore?: MemoryBattleQueueStore } = {},
  ) {
    const clock = { now: 1_000_000 };
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: { ...baseConfig, quorumVotes: 1, voteCountdownSeconds: 1 },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => clock.now,
      randomInt: pickFirst,
      battleQueueStore: overrides.battleQueueStore ?? settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: overrides.battleBetting ?? settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await loop.voteWithNullifier("cutoff-1", [0, 1]);
    clock.now += 1_000;
    await loop.tick(clock.now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "cutoff-row" }));
    loop.setOutcome(0, 2);
    loop.setVideoReady("https://cdn.example/v.mp4", VIDEO_MS, "https://cdn.example/frames/seed.jpg");
    const poolId = loop.getState().poolId;
    assert.ok(poolId);
    return { loop, clock, settle, poolId };
  }

  it("keeps betting open until a room reports playback start", async () => {
    const { loop, clock, settle, poolId } = await readyBout();
    clock.now += 10 * 60_000;
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().bettingClosesAt, null);
    assert.doesNotThrow(() => loop.assertBetAllowed(poolId));
    assert.ok(!settle.betCalls.some((c) => c.startsWith("close:")));
  });

  it("stores betting_closes_at from playback start and rejects bets and votes at it", async () => {
    const { loop, clock, settle, poolId } = await readyBout();
    const startedAt = clock.now + 30_000;
    clock.now = startedAt;
    await startPlayback(loop);
    const closesAt = startedAt + baseConfig.bettingCloseAfterVideoStartSeconds * 1_000;
    assert.equal(loop.getState().videoStartedAt, startedAt);
    assert.equal(loop.getState().bettingClosesAt, closesAt);
    const row = await settle.battleQueueStore.get("cutoff-row");
    assert.equal(row?.videoStartedAt, startedAt);
    assert.equal(row?.bettingClosesAt, closesAt);
    assert.throws(() => loop.assertBetAllowed("0xabc"), /not the live pool/u);

    clock.now = closesAt - 1;
    assert.doesNotThrow(() => loop.assertBetAllowed(poolId));
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "bet");

    clock.now = closesAt;
    const iso = new Date(closesAt).toISOString();
    assert.throws(() => loop.assertBetAllowed(poolId), new RegExp(`bet rejected: betting closed at ${iso}`, "u"));
    await assert.rejects(
      () => loop.voteWithNullifier("late-voter", [2, 3]),
      new RegExp(`vote rejected: betting closed at ${iso}`, "u"),
    );
    assert.equal(loop.getState().phase, "bet", "rejected before the phase flips");

    await loop.tick(clock.now);
    assert.ok(settle.betCalls.includes(`close:${String(loop.getState().battleId)}`));
    assert.equal(loop.getState().phase, "fight");
    assert.equal(loop.getState().endsAt, startedAt + VIDEO_MS);
  });

  it("a failed closeBetting stays in bet, shows the error, and retries", async () => {
    const calls: string[] = [];
    const battleBetting = trackingBattleBetting(calls);
    let closeFails = true;
    battleBetting.closeBetting = async (battleId) => {
      if (closeFails) throw new Error("sui rpc 503");
      calls.push(`close:${battleId}`);
    };
    const { loop, clock, poolId } = await readyBout({ battleBetting });
    await startPlayback(loop);
    clock.now += baseConfig.bettingCloseAfterVideoStartSeconds * 1_000;
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "bet");
    assert.match(loop.getState().error ?? "", /closeBetting failed .*sui rpc 503.*bettingClosed is not set/u);
    assert.throws(() => loop.assertBetAllowed(poolId), /betting closed at/u);

    closeFails = false;
    clock.now += 2_000;
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "fight");
    assert.equal(loop.getState().error, null);
  });

  it("a failed battle_results write leaves betting open and names the battle", async () => {
    class FailingStore extends MemoryBattleQueueStore {
      override async save(record: Parameters<MemoryBattleQueueStore["save"]>[0]): Promise<void> {
        if (record.bettingClosesAt !== null) throw new Error("disk full");
        await super.save(record);
      }
    }
    const { loop, clock } = await readyBout({ battleQueueStore: new FailingStore() });
    const battleId = loop.getState().battleId;
    await assert.rejects(
      () => startPlayback(loop),
      (cause: unknown) =>
        cause instanceof StoreWriteError &&
        cause.message.includes(`battle ${String(battleId)}`) &&
        cause.message.includes("disk full"),
    );
    assert.equal(loop.getState().bettingClosesAt, null);
    clock.now += 60_000;
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "bet");
  });
});

describe("stored vote and tally", () => {
  function tallyLoop(roundStore: MemoryRoundStore, quorumVotes = 2) {
    const clock = { now: 5_000_000 };
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: { ...baseConfig, quorumVotes, voteCountdownSeconds: 1 },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => clock.now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      roundStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    const states: RoundState[] = [];
    loop.subscribe((state) => states.push(state));
    return { loop, clock, settle, states };
  }

  async function closeCountdown(loop: GameLoop, clock: { now: number }): Promise<void> {
    clock.now += 1_000;
    await loop.tick(clock.now);
  }

  it("stores each vote with its ENS labels and refuses a second vote from the same nullifier", async () => {
    const store = new MemoryRoundStore();
    const { loop } = tallyLoop(store);
    await loop.voteWithNullifier("111", [0, 2]);
    await assert.rejects(() => loop.voteWithNullifier("111", [1, 3]), /already voted this round: 111/u);
    assert.equal(loop.getState().voters, 1);
    assert.deepEqual(
      store.votes.map((v) => [v.nullifier, v.picks]),
      [["111", ["alpha", "charlie"]]],
    );
    assert.equal(store.seasons.length, 1);
    assert.deepEqual([...store.rounds.values()].map((r) => r.roundNumber), [1]);
  });

  it("shows the stored tally before bet and fights its top two", async () => {
    const store = new MemoryRoundStore();
    const stored = store.storeTally.bind(store);
    store.storeTally = async (roundId) => {
      const rows = await stored(roundId);
      return rows.map((row) => (row.ensLabel === "delta" ? { ...row, voteCount: 9 } : row));
    };
    const { loop, clock, states } = tallyLoop(store);
    await loop.voteWithNullifier("1", [0, 1]);
    clock.now += 10;
    await loop.voteWithNullifier("2", [1, 3]);
    await closeCountdown(loop, clock);

    const firstTally = states.findIndex((s) => s.tally !== null);
    const firstBet = states.findIndex((s) => s.phase === "bet");
    assert.ok(firstTally >= 0 && firstTally < firstBet, "tally is emitted before phase becomes bet");
    assert.notEqual(states[firstTally]?.phase, "bet");
    assert.deepEqual(
      loop.getState().tally?.map((t) => [labels[t.id], t.votes]),
      [["delta", 9], ["bravo", 2], ["alpha", 1]],
    );
    assert.deepEqual(loop.getState().fighters, [3, 1], "fighters come from the stored rows, not in-memory counts");
  });

  it("a failed tally insert leaves betting closed and names the round and the database error", async () => {
    const store = new MemoryRoundStore();
    store.storeTally = async () => {
      throw new Error("connection reset by peer");
    };
    const { loop, clock, settle } = tallyLoop(store, 1);
    await loop.voteWithNullifier("1", [0, 1]);
    await closeCountdown(loop, clock);
    const state = loop.getState();
    assert.equal(state.phase, "over");
    assert.match(state.error ?? "", /Tally insert failed for round 1 \(rounds\.id=round-1\): connection reset by peer/u);
    assert.equal(state.tally, null);
    assert.equal(state.battleId, null);
    assert.deepEqual(settle.betCalls, []);
  });

  it("a failed vote insert is not counted and names the round", async () => {
    const store = new MemoryRoundStore();
    store.insertVote = async () => {
      throw new Error("disk full");
    };
    const { loop } = tallyLoop(store);
    await assert.rejects(
      () => loop.voteWithNullifier("1", [0, 1]),
      (cause: unknown) =>
        cause instanceof StoreWriteError && /Vote insert failed for round 1 .*disk full.*not counted/u.test(cause.message),
    );
    assert.equal(loop.getState().voters, 0);
    assert.deepEqual(loop.getState().votes[0], 0);
  });

  it("rejects a vote once the countdown has ended and the tally is being stored", async () => {
    const store = new MemoryRoundStore();
    const stored = store.storeTally.bind(store);
    let release = (): void => {};
    store.storeTally = async (roundId) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return stored(roundId);
    };
    const { loop, clock } = tallyLoop(store, 1);
    await loop.voteWithNullifier("1", [0, 1]);
    const closing = closeCountdown(loop, clock);
    await flushFightJob();
    await assert.rejects(() => loop.voteWithNullifier("2", [2, 3]), /voting for round 1 is closed/u);
    release();
    await closing;
    assert.equal(loop.getState().phase, "bet");
    assert.equal(store.votes.length, 1);
  });
});

describe("chain call retries", () => {
  function retryLoop(
    overrides: {
      chainWritePorts?: ChainWritePorts;
      battleBetting?: BattleBettingPorts;
      fightJob?: FightJobRunner;
    } = {},
  ) {
    const clock = { now: 0 };
    const deps = unusedSettleDeps();
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        bettingCloseAfterVideoStartSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => clock.now,
      randomInt: pickFirst,
      battleQueueStore: deps.battleQueueStore,
      roundStore: deps.roundStore,
      chainWritePorts: overrides.chainWritePorts ?? deps.chainWritePorts,
      battleBetting: overrides.battleBetting ?? deps.battleBetting,
      fightJob: overrides.fightJob ?? deps.fightJob,
    });
    return { loop, clock, deps };
  }

  async function openStageOneBout(loop: GameLoop, clock: { now: number }): Promise<void> {
    await loop.voteWithNullifier("retry-voter", [0, 1]);
    clock.now += 1_000;
    await loop.tick(clock.now);
  }

  async function readyAlphaWin(loop: GameLoop): Promise<void> {
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "retry-row" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await startPlayback(loop);
  }

  it("a retried settle holds the round until it finishes and keeps its error on that bout", async () => {
    const pending = { reject: (_cause: Error): void => {} };
    let writeStatus = async (): Promise<string> => {
      throw new Error("rpc timeout on status write");
    };
    const { loop, clock, deps } = retryLoop({
      chainWritePorts: {
        writeWinnerInjuries: async () => "0xinjuries",
        writeLoserStatusDead: () => writeStatus(),
        settleBattle: async () => "0xsettle",
      },
    });
    await openStageOneBout(loop, clock);
    await readyAlphaWin(loop);
    clock.now += 1_000;
    await loop.tick(clock.now);
    clock.now += 1;
    await loop.tick(clock.now);
    assert.match(loop.getState().error ?? "", /rpc timeout on status write/u);

    writeStatus = () =>
      new Promise<string>((_resolve, reject) => {
        pending.reject = reject;
      });
    const retry = loop.retrySettle();
    await flushFightJob();
    clock.now += 60_000;
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "settle", "tick must not start the next bout mid-retry");
    await assert.rejects(() => loop.retrySettle(), /already running/u);

    pending.reject(new Error("rpc timeout on the retry"));
    await retry;
    const state = loop.getState();
    assert.equal(state.round, 1);
    assert.equal(state.phase, "settle");
    assert.match(state.error ?? "", /rpc timeout on the retry/u);
    assert.equal(deps.betCalls.filter((c) => c.startsWith("open:")).length, 1);
  });

  it("retries a failed cancel from tick, backing off, until it lands", async () => {
    const calls: string[] = [];
    const battleBetting = trackingBattleBetting(calls);
    let failures = 2;
    battleBetting.cancelBattle = async (battleId) => {
      calls.push(`cancel:${battleId}`);
      if (failures > 0) {
        failures -= 1;
        throw new Error("sui rpc 503");
      }
    };
    const { loop, clock } = retryLoop({ battleBetting });
    await openStageOneBout(loop, clock);
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    const cancels = () => calls.filter((c) => c === `cancel:${battleId}`).length;

    await loop.failVideo("fal render failed: timeout");
    assert.equal(loop.getState().phase, "over");
    assert.equal(cancels(), 1);
    const failedAt = clock.now;
    await loop.tick(failedAt + 1);
    assert.equal(cancels(), 1, "the next tick waits out the backoff");
    await loop.tick(failedAt + 60_000);
    assert.equal(cancels(), 2);
    await loop.tick(failedAt + 60_001);
    assert.equal(cancels(), 2);
    await loop.tick(failedAt + 180_000);
    assert.equal(cancels(), 3);
    await loop.tick(failedAt + 3_600_000);
    assert.equal(cancels(), 3, "a landed cancel is not sent again");
  });

  function failingOpens(calls: string[], failures: number): BattleBettingPorts {
    const battleBetting = trackingBattleBetting(calls);
    let left = failures;
    battleBetting.openBattle = async (battleId) => {
      if (left > 0) {
        left -= 1;
        calls.push(`open-failed:${battleId}`);
        throw new Error("sui rpc 503");
      }
      calls.push(`open:${battleId}`);
    };
    return battleBetting;
  }

  it("runs a bout whose pool has not opened and retries the same battle id until it lands", async () => {
    const calls: string[] = [];
    const requests: FightJobRequest[] = [];
    const { loop, clock } = retryLoop({
      battleBetting: failingOpens(calls, 2),
      fightJob: async (request) => {
        requests.push(request);
        return new Promise(() => {});
      },
    });
    await openStageOneBout(loop, clock);
    await flushFightJob();
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().error, null);
    assert.equal(loop.getState().poolId, null);
    assert.deepEqual(requests.map((r) => r.battleId), [battleId], "the fight job starts without the pool");
    assert.throws(() => loop.assertBetAllowed(`0xpool-${battleId}`), /not the live pool/u);

    await readyAlphaWin(loop);
    clock.now += 1_000;
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "bet", "betting cannot close on a pool that never opened");
    assert.ok(!calls.some((c) => c.startsWith("close:")));

    clock.now += 60_000;
    await loop.tick(clock.now);
    clock.now += 60_000;
    await loop.tick(clock.now);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("open")),
      [`open-failed:${battleId}`, `open-failed:${battleId}`, `open:${battleId}`],
    );
    assert.equal(loop.getState().poolId, `0xpool-${battleId}`);
    assert.equal(loop.getState().phase, "fight");
  });

  it("stops opening the pool once the bout leaves bet, and still cancels it", async () => {
    const calls: string[] = [];
    const { loop, clock } = retryLoop({
      battleBetting: failingOpens(calls, Number.POSITIVE_INFINITY),
    });
    await openStageOneBout(loop, clock);
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    await loop.failVideo("fal render failed: timeout");
    clock.now += 3_600_000;
    await loop.tick(clock.now);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("open")),
      [`open-failed:${battleId}`],
    );
    assert.ok(calls.includes(`cancel:${battleId}`));
  });
});
