import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MemoryBattleQueueStore,
  type BattleQueueInsert,
  type ChainWritePorts,
} from "@horror-tube/fight/battle-queue";

import type { BattleBettingPorts } from "../src/battle-betting.js";
import { readSkipBattleSettlement } from "../src/env.js";
import type { FightJobRequest, FightJobResult } from "../src/fight-job.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
} from "../src/game/config.js";
import { GameLoop } from "../src/game/loop.js";
import { refuseUnverifiedWorldId } from "../src/game/world-id.js";

const baseConfig = {
  quorumVotes: 2,
  voteCountdownSeconds: 15,
  betMinSeconds: 10,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

const labels = ["alpha", "bravo", "charlie", "delta"];

const allAliveStatuses = (ensLabels: string[]): string[] =>
  ensLabels.map(() => "alive");

/** Pin challenger to the first living non-winner. */
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
    async settleBattle(battleId) {
      calls.push(`settle:${battleId}`);
      return "0xsettle";
    },
  };
}

function trackingBattleBetting(calls: string[]): BattleBettingPorts {
  let nextId = 1n;
  return {
    async minBet() {
      return 10_000_000_000_000n;
    },
    async openBattle(fighterA, fighterB, closesAtUnix) {
      const id = nextId;
      nextId += 1n;
      calls.push(
        `open:${fighterA},${fighterB},${String(closesAtUnix)}→${String(id)}`,
      );
      return id;
    },
    async placeBet(battleId, fighter, valueWei) {
      calls.push(
        `bet:${String(battleId)},${String(fighter)},${String(valueWei)}`,
      );
      return `0xbet${String(battleId)}` as `0x${string}`;
    },
    async cancelBattle(battleId) {
      calls.push(`cancel:${String(battleId)}`);
      return `0xcancel${String(battleId)}` as `0x${string}`;
    },
  };
}

/** Stage-1 vote [0, 1] ranks alpha then bravo; outcome 0 is an alpha win. */
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

function unusedSettleDeps(skipSettlement = true) {
  const calls: string[] = [];
  const betCalls: string[] = [];
  return {
    battleQueueStore: new MemoryBattleQueueStore(),
    chainWritePorts: trackingPorts(calls),
    battleBetting: trackingBattleBetting(betCalls),
    // Hang so tests that drive setOutcome/setVideoReady themselves are not raced.
    fightJob: (): Promise<FightJobResult> => new Promise(() => {}),
    skipSettlement,
    calls,
    betCalls,
  };
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
      BET_MIN_SECONDS: "10",
      VIDEO_TIMEOUT_SECONDS: "300",
      SETTLE_SECONDS: "8",
    });
    assert.deepEqual(cfg, {
      quorumVotes: 1,
      voteCountdownSeconds: 15,
      betMinSeconds: 10,
      videoTimeoutSeconds: 300,
      settleSeconds: 8,
    });
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

  it("reads SKIP_BATTLE_SETTLEMENT as 0 or 1 only", () => {
    assert.equal(readSkipBattleSettlement({ SKIP_BATTLE_SETTLEMENT: "1" }), true);
    assert.equal(readSkipBattleSettlement({ SKIP_BATTLE_SETTLEMENT: "0" }), false);
    assert.throws(
      () => readSkipBattleSettlement({}),
      /SKIP_BATTLE_SETTLEMENT is required\. Set it in \.env\. See \.env\.example\./u,
    );
    assert.throws(
      () => readSkipBattleSettlement({ SKIP_BATTLE_SETTLEMENT: "yes" }),
      /SKIP_BATTLE_SETTLEMENT must be "0" or "1"/u,
    );
  });
});

describe("World ID vote gate", () => {
  it("refuses unverified votes by default", async () => {
    await assert.rejects(
      () => refuseUnverifiedWorldId({}),
      /World ID verification is not available/u,
    );
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: settle.skipSettlement,
    });
    await assert.rejects(
      () => loop.vote({ fake: true }, [0, 1]),
      /World ID verification is not available/u,
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
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "dead-vote" }),
    });
    assert.equal(loop.getState().chars[1]?.alive, false);
    await assert.rejects(
      () => loop.vote({}, [1, 0]),
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
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
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
          chainWritePorts: settle.chainWritePorts,
          battleBetting: settle.battleBetting,
          fightJob: settle.fightJob,
          skipSettlement: true,
        }),
      /bravo.*ghost|ghost.*bravo/u,
    );
  });

  it("resetFromOver keeps characters that started dead on chain not alive", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const trio = ["alpha", "bravo", "charlie"];
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: trio,
      ensStatuses: ["alive", "alive", "dead"],
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "reset-dead" }),
    });
    assert.equal(loop.getState().chars[2]?.alive, false);
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "reset-over" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady(
      "https://cdn.example/v.mp4",
      1,
      "https://cdn.example/frames/seed.jpg",
      "film",
    );
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
    let nullifierSeq = 0;
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 2,
        voteCountdownSeconds: 5,
        betMinSeconds: 2,
        settleSeconds: 3,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => {
        nullifierSeq += 1;
        return { nullifier: `n-${String(nullifierSeq)}` };
      },
    });

    assert.equal(loop.getState().phase, "vote");
    assert.equal(loop.getState().endsAt, null);
    assert.equal(loop.getState().slots, 2);
    assert.equal(loop.getState().champion, null);

    await loop.vote({}, [0, 1]);
    assert.equal(loop.getState().phase, "vote");
    assert.equal(loop.getState().voters, 1);

    await loop.vote({}, [1, 2]);
    assert.equal(loop.getState().phase, "countdown");
    assert.equal(loop.getState().endsAt, now + 5_000);

    now += 5_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.ok(loop.getState().fighters);
    // votes: 0→1, 1→2, 2→1 → top are 1 then 0
    assert.deepEqual(loop.getState().fighters, [1, 0]);
    assert.ok(
      settle.betCalls.some((c) => c.startsWith("open:bravo,alpha,")),
      `expected openBattle for bravo vs alpha, got ${JSON.stringify(settle.betCalls)}`,
    );

    await loop.bet(0, 2);
    assert.deepEqual(loop.getState().pool, [2, 0]);
    assert.ok(
      settle.betCalls.some((c) => c.startsWith("bet:1,0,20000000000000")),
      `expected placeBet call, got ${JSON.stringify(settle.betCalls)}`,
    );

    await loop.attachAgentResult(sampleAgentInsert());
    loop.setOutcome(0, 3);
    loop.setVideoReady(
      "https://cdn.example/videos/fight1.mp4",
      4_000,
      "https://cdn.example/frames/fight1.jpg",
      "rotoscope",
    );
    assert.equal(loop.getState().phase, "bet");
    now += 2_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "fight");
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/fight1.mp4");
    assert.equal(loop.getState().videoStyle, "rotoscope");
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
    assert.deepEqual(settle.calls, ["injuries", "status"]);

    now += 3_000;
    await loop.tick(now);
    // Stage 2+: no challenger ballot — next bout opens from nextRotationPair.
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().round, 2);
    assert.equal(loop.getState().champion, 1);
    // Living non-winners in id order: charlie(2), delta(3). pickFirst → charlie.
    assert.deepEqual(loop.getState().fighters, [1, 2]);
    // Previous last frame stays on the round for the next image-to-video job.
    assert.equal(loop.getState().videoUrl, null);
    assert.equal(loop.getState().videoStyle, null);
    assert.equal(
      loop.getState().frameUrl,
      "https://cdn.example/frames/fight1.jpg",
    );
  });

  it("calls settleBattle when skipSettlement is false", async () => {
    let now = 0;
    let n = 0;
    const settle = unusedSettleDeps(false);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: false,
      verifyWorldId: async () => {
        n += 1;
        return { nullifier: `settle-call-${String(n)}` };
      },
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "settle-on" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg", "film");
    now += 1_000;
    await loop.tick(now);
    now += 1;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
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
      async settleBattle(battleId) {
        calls.push(`settle:${battleId}`);
        return "0xsettle";
      },
    };
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: store,
      chainWritePorts: ports,
      battleBetting: trackingBattleBetting([]),
      fightJob: (): Promise<FightJobResult> => new Promise(() => {}),
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "ens-fail" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "fail-status" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg", "film");
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
    assert.deepEqual(calls, ["injuries", "status"]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
  });

  it("refuses an agent result that names a different winner than the bout", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "mismatch" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(sampleAgentInsert({ id: "wrong-winner" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg", "film");
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

  it("names the missing agent result when settle runs without attachAgentResult", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "no-agent" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg", "film");
    now += 1_000;
    await loop.tick(now);
    now += 1;
    await assert.rejects(
      () => loop.tick(now),
      /attached agent result/u,
    );
    assert.deepEqual(settle.calls, []);
  });

  it("rejects duplicate nullifier and dead picks in stage 1", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 2,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "same" }),
    });
    await loop.vote({}, [0, 1]);
    await assert.rejects(() => loop.vote({}, [2, 3]), /already voted/u);

    let n = 0;
    const settle2 = unusedSettleDeps(true);
    const loop2 = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle2.battleQueueStore,
      chainWritePorts: settle2.chainWritePorts,
      battleBetting: settle2.battleBetting,
      fightJob: settle2.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => {
        n += 1;
        return { nullifier: `uniq-${String(n)}` };
      },
    });
    await loop2.vote({}, [0, 1]);
    now += 1_000;
    await loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    await loop2.attachAgentResult(agentInsertForAlphaWin({ id: "dup-path" }));
    loop2.setOutcome(0, 0);
    loop2.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg", "film");
    now += 1_000;
    await loop2.tick(now);
    now += 1;
    await loop2.tick(now);
    now += 1_000;
    await loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    assert.equal(loop2.getState().champion, 0);
    // Winner alpha(0); living non-winners charlie,delta (bravo dead) → pickFirst → charlie(2)
    assert.deepEqual(loop2.getState().fighters, [0, 2]);
    assert.equal(loop2.getState().chars[1]?.alive, false);
    assert.deepEqual(settle2.calls, ["injuries", "status"]);
  });

  it("rejects bet outside bet phase and empty video url", async () => {
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "x" }),
    });
    await assert.rejects(() => loop.bet(0, 1), /bet phase/u);
    let now = 0;
    const settle2 = unusedSettleDeps();
    const loop2 = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle2.battleQueueStore,
      chainWritePorts: settle2.chainWritePorts,
      battleBetting: settle2.battleBetting,
      fightJob: settle2.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "y" }),
    });
    await loop2.vote({}, [0, 1]);
    now += 1_000;
    await loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    assert.throws(() => loop2.setVideoReady("  ", 1000, "https://cdn.example/frames/seed.jpg", "film"), /non-empty/u);
    assert.throws(
      () =>
        loop2.setVideoReady(
          "https://cdn.example/v.mp4",
          1000,
          "  ",
          "film",
        ),
      /frameUrl must be non-empty/u,
    );
  });

  it("requires randomInt before starting a stage-2 bout", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "z" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await loop.attachAgentResult(agentInsertForAlphaWin({ id: "no-random" }));
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg", "film");
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

  it("after failVideo refuses bets, cancels the battle, and leaves bet for over", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        videoTimeoutSeconds: 5,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "fail-video" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    await loop.bet(0, 1);
    assert.deepEqual(loop.getState().pool, [1, 0]);

    await loop.failVideo("fal render failed: timeout");
    assert.equal(loop.getState().phase, "over");
    assert.equal(loop.getState().error, "fal render failed: timeout");
    assert.deepEqual(loop.getState().pool, [0, 0]);
    assert.ok(
      settle.betCalls.some((c) => c === "cancel:1"),
      `expected cancelBattle, got ${JSON.stringify(settle.betCalls)}`,
    );
    await assert.rejects(
      () => loop.bet(1, 1),
      /bet is only allowed in the bet phase|video failure/u,
    );
  });

  it("fight job success attaches result and sets video + outcome", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const requests: FightJobRequest[] = [];
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
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
          videoStyle: "rotoscope",
          durationMs: 2_000,
          frameUrl: "https://cdn.example/frames/job.jpg",
        };
      },
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "job-ok" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.deepEqual(loop.getState().fighters, [0, 1]);

    await flushFightJob();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.priorFrameUrl, null);
    assert.deepEqual(requests[0]?.livingSubnames, labels);
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/job.mp4");
    assert.equal(loop.getState().videoStyle, "rotoscope");
    assert.equal(loop.getState().frameUrl, "https://cdn.example/frames/job.jpg");
    assert.equal(loop.getState().error, null);
    assert.equal(loop.getState().phase, "bet", "bet stays open until BET_MIN_SECONDS");
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "fight");
  });

  it("fight job failure runs failVideo and leaves bet for over", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: async () => {
        throw new Error("FAL_KEY is required. Set it in .env. See .env.example.");
      },
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "job-fail" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await flushFightJob();
    assert.equal(loop.getState().phase, "over");
    assert.match(
      loop.getState().error ?? "",
      /Fight job failed: FAL_KEY is required/u,
    );
    assert.ok(
      settle.betCalls.some((c) => c === "cancel:1"),
      `expected cancelBattle, got ${JSON.stringify(settle.betCalls)}`,
    );
    await assert.rejects(
      () => loop.bet(0, 1),
      /bet is only allowed in the bet phase|video failure/u,
    );
  });

  it("a late fight job result is not applied to the next bout", async () => {
    let now = 0;
    const settle = unusedSettleDeps(true);
    const requests: FightJobRequest[] = [];
    const pending: Array<(result: FightJobResult) => void> = [];
    let n = 0;
    const loop = new GameLoop({
      config: { ...baseConfig, quorumVotes: 1, voteCountdownSeconds: 1 },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: (request) => {
        requests.push(request);
        return new Promise((resolve) => pending.push(resolve));
      },
      skipSettlement: true,
      verifyWorldId: async () => {
        n += 1;
        return { nullifier: `late-${String(n)}` };
      },
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    now += baseConfig.videoTimeoutSeconds * 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "over");

    loop.resetFromOver();
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    await flushFightJob();
    assert.deepEqual(
      requests.map((r) => r.battleId),
      ["1", "2"],
    );

    pending[0]?.({
      insert: agentInsertForAlphaWin({ id: "late-r1", battleId: "1" }),
      winnerSide: 0,
      damage: 1,
      videoUrl: "https://cdn.example/videos/late.mp4",
      videoStyle: "film",
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
    const settle = unusedSettleDeps(true);
    const requests: FightJobRequest[] = [];
    let call = 0;
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
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
            videoStyle: "film",
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
          videoStyle: "film",
          durationMs: 1_000,
          frameUrl: "https://cdn.example/frames/r2.jpg",
        };
      },
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "prior-frame" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    await flushFightJob();
    assert.equal(requests[0]?.priorFrameUrl, null);
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
    const settle = unusedSettleDeps(true);
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        videoTimeoutSeconds: 2,
      },
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      now: () => now,
      randomInt: pickFirst,
      battleQueueStore: settle.battleQueueStore,
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
      skipSettlement: true,
      verifyWorldId: async () => ({ nullifier: "timeout-video" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    now += 2_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "over");
    assert.match(loop.getState().error ?? "", /VIDEO_TIMEOUT_SECONDS/u);
    assert.ok(settle.betCalls.some((c) => c.startsWith("cancel:")));
    await assert.rejects(() => loop.bet(0, 1), /bet phase|video failure/u);
  });
});
