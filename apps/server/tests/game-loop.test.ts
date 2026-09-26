import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MemoryBattleQueueStore,
  type BattleQueueInsert,
  type ChainWritePorts,
} from "@horror-tube/fight/battle-queue";
import type { RandomInt } from "@horror-tube/fight/rotation";

import type { BattleBettingPorts } from "../src/battle-betting.js";
import type { FightJobRequest, FightJobResult, FightJobRunner } from "../src/fight-job.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
  type GameLoopConfig,
} from "../src/game/config.js";
import { MemoryRoundStore } from "../src/db/rounds.js";
import { botSide, type HouseBots } from "../src/game/house-bot.js";
import { GameLoop, StartRefusedError, StoreWriteError } from "../src/game/loop.js";
import { createHouseBotChains, readHouseBotStakeUnits } from "../src/house-bot-chain.js";

const baseConfig: GameLoopConfig = {
  bettingCloseAfterVideoStartSeconds: 5,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

const fastConfig: Partial<GameLoopConfig> = {
  bettingCloseAfterVideoStartSeconds: 1,
  settleSeconds: 1,
};

const labels = ["alpha", "bravo", "charlie", "delta"];

const pickFirst: RandomInt = () => 0;

const NO_HOUSE_BOTS: HouseBots = { chains: [], stakeUnits: 1n };

function pinnedRandom(...draws: number[]): RandomInt {
  let i = 0;
  return (maxExclusive) => {
    const value = draws[i];
    i += 1;
    if (value === undefined) {
      throw new Error(
        `pinnedRandom exhausted after ${String(draws.length)} draws (maxExclusive=${String(maxExclusive)})`,
      );
    }
    if (value >= maxExclusive) {
      throw new Error(
        `pinnedRandom draw ${String(value)} is out of range for maxExclusive=${String(maxExclusive)}`,
      );
    }
    return value;
  };
}

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

function agentInsertForAlphaWin(overrides: Partial<BattleQueueInsert> = {}): BattleQueueInsert {
  return {
    id: "agent-queue-1",
    battleId: "99",
    fighterASubname: "alpha",
    fighterBSubname: "bravo",
    shots: [
      {
        time_range: "0-4s",
        characters: "alpha and bravo",
        action: "clash",
        camera: "wide",
        style: "gritty",
      },
    ],
    ensLines: ["bravo|status=dead", 'alpha|injuries=["cut"]'],
    rationale: "alpha wins the opening bout",
    winnerSubname: "alpha",
    loserSubname: "bravo",
    winnerInjuries: ["cut"],
    nextOpponentSubname: "charlie",
    ...overrides,
  };
}

function fightJobThatNeverFinishes(): Promise<FightJobResult> {
  return new Promise(() => {});
}

function loopDeps() {
  const calls: string[] = [];
  const betCalls: string[] = [];
  const fightJob: FightJobRunner = fightJobThatNeverFinishes;
  return {
    battleQueueStore: new MemoryBattleQueueStore(),
    roundStore: new MemoryRoundStore(),
    chainWritePorts: trackingPorts(calls),
    battleBetting: trackingBattleBetting(betCalls),
    fightJob,
    calls,
    betCalls,
  };
}

type LoopDeps = ReturnType<typeof loopDeps>;

function makeLoop(
  overrides: {
    config?: Partial<GameLoopConfig>;
    ensLabels?: string[];
    ensStatuses?: string[];
    randomInt?: RandomInt;
    houseBots?: HouseBots;
    deps?: Partial<LoopDeps>;
  } = {},
) {
  const clock = { now: 0 };
  const deps: LoopDeps = { ...loopDeps(), ...overrides.deps };
  const ensLabels = overrides.ensLabels ?? labels;
  const loop = new GameLoop({
    config: { ...baseConfig, ...overrides.config },
    ensLabels,
    ensStatuses: overrides.ensStatuses ?? ensLabels.map(() => "alive"),
    now: () => clock.now,
    randomInt: overrides.randomInt ?? pickFirst,
    battleQueueStore: deps.battleQueueStore,
    roundStore: deps.roundStore,
    chainWritePorts: deps.chainWritePorts,
    battleBetting: deps.battleBetting,
    fightJob: deps.fightJob,
    houseBots: overrides.houseBots ?? NO_HOUSE_BOTS,
  });
  const step = async (ms = 0): Promise<void> => {
    clock.now += ms;
    await loop.tick(clock.now);
  };
  return { loop, clock, deps, step };
}

async function startedLoop(overrides: Parameters<typeof makeLoop>[0] = {}) {
  const harness = makeLoop(overrides);
  await harness.loop.start();
  assert.equal(harness.loop.getState().phase, "bet");
  return harness;
}

async function startPlayback(loop: GameLoop): Promise<void> {
  const battleId = loop.getState().battleId;
  assert.ok(battleId, "startPlayback needs a live battleId");
  await loop.reportPlaybackStart(battleId);
}

async function readyAlphaWin(loop: GameLoop, id: string, durationMs = 1): Promise<void> {
  await loop.attachAgentResult(agentInsertForAlphaWin({ id }));
  loop.setOutcome(0, 0);
  loop.setVideoReady(
    "https://cdn.example/v.mp4",
    durationMs,
    "https://cdn.example/frames/seed.jpg",
  );
}

async function flushFightJob(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

const opens = (betCalls: string[]): string[] => betCalls.filter((c) => c.startsWith("open:"));

describe("game loop config", () => {
  it("throws and names each timing variable when missing", () => {
    assert.throws(
      () => readGameLoopConfig({}),
      /BETTING_CLOSE_AFTER_VIDEO_START_SECONDS is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("reads all timings when present", () => {
    assert.deepEqual(
      readGameLoopConfig({
        BETTING_CLOSE_AFTER_VIDEO_START_SECONDS: "5",
        VIDEO_TIMEOUT_SECONDS: "300",
        SETTLE_SECONDS: "8",
      }),
      { bettingCloseAfterVideoStartSeconds: 5, videoTimeoutSeconds: 300, settleSeconds: 8 },
    );
  });

  it("refuses a missing, blank, or sub-1 BETTING_CLOSE_AFTER_VIDEO_START_SECONDS", () => {
    const env = { VIDEO_TIMEOUT_SECONDS: "300", SETTLE_SECONDS: "8" };
    for (const value of [undefined, " ", "0", "2.5"]) {
      assert.throws(
        () => readGameLoopConfig({ ...env, BETTING_CLOSE_AFTER_VIDEO_START_SECONDS: value }),
        /BETTING_CLOSE_AFTER_VIDEO_START_SECONDS .*See \.env\.example\./u,
        `value ${JSON.stringify(value)}`,
      );
    }
  });

  it("requires ROSTER_ENS_LABELS with at least two labels", () => {
    assert.throws(() => readRosterEnsLabels({}), /ROSTER_ENS_LABELS/u);
    assert.throws(() => readRosterEnsLabels({ ROSTER_ENS_LABELS: "only-one" }), /at least two/u);
    assert.deepEqual(readRosterEnsLabels({ ROSTER_ENS_LABELS: "zebra,alpha,bravo" }), [
      "alpha",
      "bravo",
      "zebra",
    ]);
  });
});

describe("GameLoop ENS status", () => {
  it("treats empty status as alive and dead as dead", () => {
    const { loop } = makeLoop({ ensStatuses: ["", "dead", "alive", "alive"] });
    assert.deepEqual(
      loop.getState().chars.map((c) => c.alive),
      [true, false, true, true],
    );
  });

  it("throws naming the label and value for unknown status", () => {
    assert.throws(
      () => makeLoop({ ensStatuses: ["alive", "ghost", "alive", "alive"] }),
      /bravo.*ghost|ghost.*bravo/u,
    );
  });
});

describe("start", () => {
  it("waits without opening a bout until start is called", async () => {
    const requests: FightJobRequest[] = [];
    const { loop, deps, step } = makeLoop({
      deps: {
        fightJob: async (request) => {
          requests.push(request);
          return fightJobThatNeverFinishes();
        },
      },
    });
    await step(60 * 60_000);
    const state = loop.getState();
    assert.equal(state.phase, "waiting");
    assert.equal(state.fighters, null);
    assert.equal(state.battleId, null);
    assert.deepEqual(deps.betCalls, []);
    assert.deepEqual(requests, []);
    assert.equal(deps.roundStore.seasons.length, 0);
  });

  it("opens exactly one bout from a random living fighter and a random living opponent", async () => {
    const requests: FightJobRequest[] = [];
    const { loop, deps } = await startedLoop({
      randomInt: pinnedRandom(1, 2),
      deps: {
        fightJob: async (request) => {
          requests.push(request);
          return fightJobThatNeverFinishes();
        },
      },
    });
    await flushFightJob();
    const state = loop.getState();
    assert.deepEqual(state.fighters, [1, 3], "bravo, then delta from the living non-bravo list");
    assert.equal(state.champion, null);
    assert.equal(state.round, 1);
    assert.deepEqual(opens(deps.betCalls).length, 1);
    assert.deepEqual(
      requests.map((r) => [r.battleId, r.fighterASubname, r.fighterBSubname]),
      [[state.battleId, "bravo", "delta"]],
    );
    assert.deepEqual(deps.roundStore.openSeasonIds(), ["season-1"]);
  });

  it("never draws a dead fighter", async () => {
    const { loop } = await startedLoop({
      ensStatuses: ["alive", "dead", "alive", "alive"],
      randomInt: pinnedRandom(1, 1),
    });
    assert.deepEqual(loop.getState().fighters, [2, 3]);
  });

  it("refuses a second start while a bout is open, and while one is starting", async () => {
    const { loop, deps } = makeLoop();
    const first = loop.start();
    await assert.rejects(
      () => loop.start(),
      (cause: unknown) =>
        cause instanceof StartRefusedError &&
        /a fresh bout is already starting/u.test(cause.message),
    );
    await first;
    await assert.rejects(
      () => loop.start(),
      (cause: unknown) =>
        cause instanceof StartRefusedError &&
        /a bout is already open \(phase=bet, round=1/u.test(cause.message),
    );
    assert.equal(opens(deps.betCalls).length, 1);
    assert.equal(deps.roundStore.seasons.length, 1);
  });

  it("stays waiting and stores no season when fewer than 2 fighters live", async () => {
    const { loop, deps } = makeLoop({
      ensLabels: ["alpha", "bravo"],
      ensStatuses: ["alive", "dead"],
    });
    await assert.rejects(() => loop.start(), /fewer than 2 living/u);
    assert.equal(loop.getState().phase, "waiting");
    assert.equal(deps.roundStore.seasons.length, 0);
    assert.deepEqual(deps.betCalls, []);
  });

  it("ends every season a previous process left open before starting a new one", async () => {
    const roundStore = new MemoryRoundStore();
    const leftover = [{ ensLabel: "alpha", alive: true, kills: 0, damage: 0 }];
    await roundStore.startSeason(leftover);
    await roundStore.startSeason(leftover);
    const warns: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    try {
      await startedLoop({ deps: { roundStore } });
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(roundStore.openSeasonIds(), ["season-3"]);
    assert.match(warns.join("\n"), /ended leftover open season\(s\) season-1,season-2/u);
  });

  it("requires randomInt", async () => {
    const deps = loopDeps();
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      ensStatuses: labels.map(() => "alive"),
      battleQueueStore: deps.battleQueueStore,
      roundStore: deps.roundStore,
      chainWritePorts: deps.chainWritePorts,
      battleBetting: deps.battleBetting,
      fightJob: deps.fightJob,
      houseBots: NO_HOUSE_BOTS,
    });
    await assert.rejects(() => loop.start(), /randomInt was not provided/u);
  });

  it("starts a new season from over with the characters that started dead on chain still dead", async () => {
    const { loop, deps, step } = await startedLoop({
      config: fastConfig,
      ensLabels: ["alpha", "bravo", "charlie"],
      ensStatuses: ["alive", "alive", "dead"],
    });
    await readyAlphaWin(loop, "season-over");
    await startPlayback(loop);
    await step(1_000);
    await step(1);
    await step(1_000);
    assert.equal(loop.getState().phase, "over");
    assert.deepEqual(deps.roundStore.ended.get("season-1"), { championLabel: "alpha" });

    await loop.start();
    const state = loop.getState();
    assert.equal(state.phase, "bet");
    assert.equal(state.champion, null);
    assert.deepEqual(
      state.chars.map((c) => c.alive),
      [true, true, false],
    );
    assert.deepEqual(deps.roundStore.openSeasonIds(), ["season-2"]);
  });
});

describe("GameLoop phases", () => {
  it("runs bet→fight→settle, then the winner stays on against a random living challenger", async () => {
    const { loop, deps, step } = await startedLoop({
      config: { bettingCloseAfterVideoStartSeconds: 2, settleSeconds: 3 },
    });
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    assert.deepEqual(loop.getState().fighters, [0, 1]);
    assert.equal(loop.getState().poolId, `0xpool-${battleId}`);
    loop.setPool(battleId, `0xpool-${battleId}`, [20000, 0]);
    assert.deepEqual(loop.getState().pool, [20000, 0]);

    await loop.attachAgentResult(agentInsertForAlphaWin());
    loop.setOutcome(0, 3);
    loop.setVideoReady(
      "https://cdn.example/videos/fight1.mp4",
      4_000,
      "https://cdn.example/frames/fight1.jpg",
    );
    await startPlayback(loop);
    await step(2_000);
    assert.equal(loop.getState().phase, "fight");
    assert.ok(deps.betCalls.includes(`close:${battleId}`));

    await step(4_000);
    const settled = loop.getState();
    assert.equal(settled.phase, "settle");
    assert.equal(settled.winner, 0);
    assert.equal(settled.champion, 0);
    assert.equal(settled.chars[1]?.alive, false);
    assert.equal(settled.chars[0]?.kills, 1);
    assert.equal(settled.chars[0]?.damage, 3);
    assert.deepEqual(deps.calls, ["injuries", "status", "settle:99"]);

    await step(3_000);
    const next = loop.getState();
    assert.equal(next.phase, "bet");
    assert.equal(next.round, 2);
    assert.equal(next.champion, 0);
    assert.deepEqual(next.fighters, [0, 2]);
    assert.equal(next.videoUrl, null);
    assert.equal(next.frameUrl, "https://cdn.example/frames/fight1.jpg");
    assert.notEqual(next.battleId, battleId);
  });

  it("fills RoundState.pool from readPoolTotals during bet", async () => {
    const deps = loopDeps();
    deps.battleBetting.readPoolTotals = async (battleId) => {
      deps.betCalls.push(`read:${battleId}`);
      return [50_000n, 25_000n];
    };
    const { loop, step } = await startedLoop({ deps });
    assert.deepEqual(loop.getState().pool, [0, 0]);
    await step(1);
    assert.deepEqual(loop.getState().pool, [50_000, 25_000]);
    const reads = () => deps.betCalls.filter((c) => c.startsWith("read:")).length;
    const before = reads();
    await step(500);
    assert.equal(reads(), before);
  });

  it("keeps a failed pool settle on the round with the battle id and resumes at settle", async () => {
    let settleFails = true;
    const deps = loopDeps();
    deps.chainWritePorts.settleBattle = async (battleId) => {
      if (settleFails) {
        throw new Error(
          `Battle ${battleId}: settle on pool 0xpool-${battleId} for side 0 failed. rpc timeout`,
        );
      }
      deps.calls.push(`settle:${battleId}`);
      return "0xsettle";
    };
    const { loop, step } = await startedLoop({ config: fastConfig, deps });
    await readyAlphaWin(loop, "settle-on");
    await startPlayback(loop);
    await step(1_000);
    await step(1);
    assert.equal(loop.getState().phase, "settle");
    assert.equal(loop.getState().endsAt, null);
    assert.match(
      loop.getState().error ?? "",
      /settle step settlement failed \(battleId=99\)\. Battle 99: settle on pool 0xpool-99/u,
    );
    const saved = await deps.battleQueueStore.get("settle-on");
    assert.equal(saved?.statusTxHash, "0xstatus");
    assert.equal(saved?.settlementTxHash, null);
    await step(10_000);
    assert.equal(loop.getState().phase, "settle");

    settleFails = false;
    await loop.retrySettle();
    assert.equal(loop.getState().error, null);
    assert.equal((await deps.battleQueueStore.get("settle-on"))?.settlementTxHash, "0xsettle");
    assert.deepEqual(deps.calls, ["injuries", "status", "settle:99"]);
  });

  it("keeps a failed ENS write on the round and resumes it", async () => {
    let statusFails = true;
    const deps = loopDeps();
    deps.chainWritePorts.writeLoserStatusDead = async () => {
      if (statusFails) throw new Error("rpc timeout on status write");
      deps.calls.push("status");
      return "0xstatus";
    };
    const { loop, step } = await startedLoop({ config: fastConfig, deps });
    await readyAlphaWin(loop, "fail-status");
    await startPlayback(loop);
    await step(1_000);
    await step(1);
    assert.equal(loop.getState().phase, "settle");
    assert.equal(loop.getState().endsAt, null);
    assert.match(loop.getState().error ?? "", /status write/u);
    const saved = await deps.battleQueueStore.get("fail-status");
    assert.equal(saved?.injuriesTxHash, "0xinjuries");
    assert.equal(saved?.statusTxHash, null);
    assert.equal(saved?.bettingClosed, true);
    assert.equal(saved?.playbackFinished, true);
    await step(10_000);
    assert.equal(loop.getState().phase, "settle");

    statusFails = false;
    await loop.retrySettle();
    assert.equal(loop.getState().error, null);
    assert.equal((await deps.battleQueueStore.get("fail-status"))?.statusTxHash, "0xstatus");
    assert.deepEqual(deps.calls, ["injuries", "status", "settle:99"]);
    await step(1_000);
    assert.equal(loop.getState().phase, "bet");
  });

  it("refuses an agent result that names a different winner than the bout", async () => {
    const { loop, deps, step } = await startedLoop({ config: fastConfig });
    await loop.attachAgentResult(
      agentInsertForAlphaWin({ id: "wrong-winner", winnerSubname: "bravo", loserSubname: "alpha" }),
    );
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await startPlayback(loop);
    await step(1_000);
    await assert.rejects(() => step(1), /does not match bout winner/u);
    assert.deepEqual(deps.calls, []);
    assert.equal(loop.getState().chars[0]?.alive, true);
    assert.equal(loop.getState().chars[1]?.alive, true);
    assert.notEqual(loop.getState().error, null);
  });

  it("refuses a playback report when no agent result is attached", async () => {
    const { loop, deps, step } = await startedLoop({ config: fastConfig });
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1, "https://cdn.example/frames/seed.jpg");
    await assert.rejects(() => startPlayback(loop), /no battle_results row is attached/u);
    await step(60_000);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().bettingClosesAt, null);
    assert.deepEqual(deps.calls, []);
  });

  it("rejects an empty video or frame url", async () => {
    const { loop } = await startedLoop();
    assert.throws(
      () => loop.setVideoReady("  ", 1000, "https://cdn.example/frames/seed.jpg"),
      /non-empty/u,
    );
    assert.throws(
      () => loop.setVideoReady("https://cdn.example/v.mp4", 1000, "  "),
      /frameUrl must be non-empty/u,
    );
  });

  it("after failVideo cancels the Sui pool, leaves bet for over, and ends the season", async () => {
    const { loop, deps } = await startedLoop();
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    await loop.failVideo("fal render failed: timeout");
    const state = loop.getState();
    assert.equal(state.phase, "over");
    assert.equal(state.error, "fal render failed: timeout");
    assert.deepEqual(state.pool, [0, 0]);
    assert.ok(deps.betCalls.includes(`cancel:${battleId}`));
    assert.deepEqual(deps.roundStore.openSeasonIds(), []);
  });

  it("still cancels the pool when the season end write fails, and the next start ends that season", async () => {
    const roundStore = new MemoryRoundStore();
    roundStore.endSeason = async () => {
      throw new Error("connection reset by peer");
    };
    const errors: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      const { loop, deps } = await startedLoop({ deps: { roundStore } });
      const battleId = loop.getState().battleId;
      await loop.failVideo("fal render failed: timeout");
      assert.ok(deps.betCalls.includes(`cancel:${String(battleId)}`));
      assert.match(
        errors.join("\n"),
        /season season-1 end write failed: connection reset by peer/u,
      );
      await loop.start();
    } finally {
      console.error = error;
    }
    assert.deepEqual(roundStore.openSeasonIds(), ["season-2"]);
  });

  it("fight job success attaches result and sets video + outcome; a ready video does not close betting", async () => {
    const requests: FightJobRequest[] = [];
    const { loop, step } = await startedLoop({
      config: fastConfig,
      deps: {
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
      },
    });
    await flushFightJob();
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.priorFrameUrl, null);
    assert.deepEqual(requests[0]?.livingSubnames, labels);
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/job.mp4");
    assert.equal(loop.getState().frameUrl, "https://cdn.example/frames/job.jpg");
    await step(60_000);
    assert.equal(loop.getState().phase, "bet");
    await startPlayback(loop);
    await step(1_000);
    assert.equal(loop.getState().phase, "fight");
  });

  it("fight job failure runs failVideo and leaves bet for over", async () => {
    const { loop, deps } = makeLoop({
      deps: {
        fightJob: async () => {
          throw new Error("FAL_KEY is required. Set it in .env. See .env.example.");
        },
      },
    });
    await loop.start();
    await flushFightJob();
    assert.equal(loop.getState().phase, "over");
    assert.match(loop.getState().error ?? "", /Fight job failed: FAL_KEY is required/u);
    assert.ok(deps.betCalls.some((c) => c.startsWith("cancel:")));
  });

  it("a late fight job result is not applied to the next bout", async () => {
    const requests: FightJobRequest[] = [];
    const pending: Array<(result: FightJobResult) => void> = [];
    const { loop, step } = await startedLoop({
      deps: {
        fightJob: (request) => {
          requests.push(request);
          return new Promise((resolve) => pending.push(resolve));
        },
      },
    });
    const firstBattleId = loop.getState().battleId;
    assert.ok(firstBattleId);
    await step(baseConfig.videoTimeoutSeconds * 1_000);
    assert.equal(loop.getState().phase, "over");

    await loop.start();
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
    const requests: FightJobRequest[] = [];
    const { loop, step } = await startedLoop({
      config: fastConfig,
      deps: {
        fightJob: async (request) => {
          requests.push(request);
          const round = requests.length;
          return {
            insert: agentInsertForAlphaWin({
              id: `job-r${String(round)}`,
              battleId: request.battleId,
              fighterASubname: request.fighterASubname,
              fighterBSubname: request.fighterBSubname,
              loserSubname: request.fighterBSubname,
              ensLines: [`${request.fighterBSubname}|status=dead`, 'alpha|injuries=["cut"]'],
            }),
            winnerSide: 0,
            damage: 1,
            videoUrl: `https://cdn.example/videos/r${String(round)}.mp4`,
            durationMs: 1_000,
            frameUrl: `https://cdn.example/frames/r${String(round)}.jpg`,
          };
        },
      },
    });
    await flushFightJob();
    await startPlayback(loop);
    await step(1_000);
    await step(1_000);
    assert.equal(loop.getState().phase, "settle");
    await step(1_000);
    assert.equal(loop.getState().round, 2);
    await flushFightJob();
    assert.deepEqual(
      requests.map((r) => r.priorFrameUrl),
      [null, "https://cdn.example/frames/r1.jpg"],
    );
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/r2.mp4");
  });

  it("video timeout runs failVideo and refuses further stakes", async () => {
    const { loop, deps, step } = await startedLoop({ config: { videoTimeoutSeconds: 2 } });
    const poolId = loop.getState().poolId;
    assert.ok(poolId);
    await step(2_000);
    assert.equal(loop.getState().phase, "over");
    assert.match(loop.getState().error ?? "", /VIDEO_TIMEOUT_SECONDS/u);
    assert.ok(deps.betCalls.some((c) => c.startsWith("cancel:")));
    assert.throws(() => loop.assertBetAllowed(poolId), /only open in the bet phase/u);
  });
});

describe("betting cutoff", () => {
  const VIDEO_MS = 8_000;

  async function readyBout(deps: Partial<LoopDeps> = {}) {
    const harness = await startedLoop({ deps });
    await readyAlphaWin(harness.loop, "cutoff-row", VIDEO_MS);
    const poolId = harness.loop.getState().poolId;
    assert.ok(poolId);
    return { ...harness, poolId };
  }

  it("keeps betting open until a room reports playback start", async () => {
    const { loop, deps, step, poolId } = await readyBout();
    await step(10 * 60_000);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().bettingClosesAt, null);
    assert.doesNotThrow(() => loop.assertBetAllowed(poolId));
    assert.ok(!deps.betCalls.some((c) => c.startsWith("close:")));
  });

  it("stores betting_closes_at from playback start and rejects bets at it", async () => {
    const { loop, deps, clock, step, poolId } = await readyBout();
    const startedAt = clock.now + 30_000;
    clock.now = startedAt;
    await startPlayback(loop);
    const closesAt = startedAt + baseConfig.bettingCloseAfterVideoStartSeconds * 1_000;
    assert.equal(loop.getState().videoStartedAt, startedAt);
    assert.equal(loop.getState().bettingClosesAt, closesAt);
    const row = await deps.battleQueueStore.get("cutoff-row");
    assert.equal(row?.videoStartedAt, startedAt);
    assert.equal(row?.bettingClosesAt, closesAt);
    assert.throws(() => loop.assertBetAllowed("0xabc"), /not the live pool/u);

    clock.now = closesAt - 1;
    assert.doesNotThrow(() => loop.assertBetAllowed(poolId));
    await step();
    assert.equal(loop.getState().phase, "bet");

    clock.now = closesAt;
    const iso = new Date(closesAt).toISOString();
    assert.throws(
      () => loop.assertBetAllowed(poolId),
      new RegExp(`bet rejected: betting closed at ${iso}`, "u"),
    );
    assert.equal(loop.getState().phase, "bet", "rejected before the phase flips");
    await step();
    assert.ok(deps.betCalls.includes(`close:${String(loop.getState().battleId)}`));
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
    const { loop, step, poolId } = await readyBout({ battleBetting });
    await startPlayback(loop);
    await step(baseConfig.bettingCloseAfterVideoStartSeconds * 1_000);
    assert.equal(loop.getState().phase, "bet");
    assert.match(
      loop.getState().error ?? "",
      /closeBetting failed .*sui rpc 503.*bettingClosed is not set/u,
    );
    assert.throws(() => loop.assertBetAllowed(poolId), /betting closed at/u);

    closeFails = false;
    await step(2_000);
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
    const { loop, step } = await readyBout({ battleQueueStore: new FailingStore() });
    const battleId = loop.getState().battleId;
    await assert.rejects(
      () => startPlayback(loop),
      (cause: unknown) =>
        cause instanceof StoreWriteError &&
        cause.message.includes(`battle ${String(battleId)}`) &&
        cause.message.includes("disk full"),
    );
    assert.equal(loop.getState().bettingClosesAt, null);
    await step(60_000);
    assert.equal(loop.getState().phase, "bet");
  });
});

describe("chain call retries", () => {
  it("a retried settle holds the round until it finishes and keeps its error on that bout", async () => {
    const pending = { reject: (_cause: Error): void => {} };
    let writeStatus = async (): Promise<string> => {
      throw new Error("rpc timeout on status write");
    };
    const deps = loopDeps();
    deps.chainWritePorts.writeLoserStatusDead = () => writeStatus();
    const { loop, step } = await startedLoop({ config: fastConfig, deps });
    await readyAlphaWin(loop, "retry-row");
    await startPlayback(loop);
    await step(1_000);
    await step(1);
    assert.match(loop.getState().error ?? "", /rpc timeout on status write/u);

    writeStatus = () =>
      new Promise<string>((_resolve, reject) => {
        pending.reject = reject;
      });
    const retry = loop.retrySettle();
    await flushFightJob();
    await step(60_000);
    assert.equal(loop.getState().phase, "settle", "tick must not start the next bout mid-retry");
    await assert.rejects(() => loop.retrySettle(), /already running/u);

    pending.reject(new Error("rpc timeout on the retry"));
    await retry;
    const state = loop.getState();
    assert.equal(state.round, 1);
    assert.equal(state.phase, "settle");
    assert.match(state.error ?? "", /rpc timeout on the retry/u);
    assert.equal(opens(deps.betCalls).length, 1);
  });

  it("retries a failed cancel from tick, backing off, until it lands", async () => {
    const deps = loopDeps();
    let failures = 2;
    deps.battleBetting.cancelBattle = async (battleId) => {
      deps.betCalls.push(`cancel:${battleId}`);
      if (failures > 0) {
        failures -= 1;
        throw new Error("sui rpc 503");
      }
    };
    const { loop, clock } = await startedLoop({ deps });
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    const cancels = () => deps.betCalls.filter((c) => c === `cancel:${battleId}`).length;

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
    const { loop, step } = await startedLoop({
      config: fastConfig,
      deps: {
        battleBetting: failingOpens(calls, 2),
        fightJob: async (request) => {
          requests.push(request);
          return fightJobThatNeverFinishes();
        },
      },
    });
    await flushFightJob();
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    assert.equal(loop.getState().error, null);
    assert.equal(loop.getState().poolId, null);
    assert.deepEqual(
      requests.map((r) => r.battleId),
      [battleId],
      "the fight job starts without the pool",
    );
    assert.throws(() => loop.assertBetAllowed(`0xpool-${battleId}`), /not the live pool/u);

    await readyAlphaWin(loop, "retry-row");
    await startPlayback(loop);
    await step(1_000);
    assert.equal(loop.getState().phase, "bet", "betting cannot close on a pool that never opened");
    assert.ok(!calls.some((c) => c.startsWith("close:")));

    await step(60_000);
    await step(60_000);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("open")),
      [`open-failed:${battleId}`, `open-failed:${battleId}`, `open:${battleId}`],
    );
    assert.equal(loop.getState().poolId, `0xpool-${battleId}`);
    assert.equal(loop.getState().phase, "fight");
  });

  it("stops opening the pool once the bout leaves bet, and still cancels it", async () => {
    const calls: string[] = [];
    const { loop, step } = await startedLoop({
      deps: { battleBetting: failingOpens(calls, Number.POSITIVE_INFINITY) },
    });
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    await loop.failVideo("fal render failed: timeout");
    await step(3_600_000);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("open")),
      [`open-failed:${battleId}`],
    );
    assert.ok(calls.includes(`cancel:${battleId}`));
  });
});

describe("house bot", () => {
  const BOT = "0xb07";
  const STAKE = 500_000n;

  async function botBout(bet?: (poolId: string, side: 0 | 1, units: bigint) => Promise<string>) {
    const totals: [bigint, bigint] = [0n, 0n];
    const botCalls: string[] = [];
    const deps = loopDeps();
    deps.battleBetting.readPoolTotals = async () => totals;
    const harness = makeLoop({
      config: { bettingCloseAfterVideoStartSeconds: 5, settleSeconds: 1 },
      deps,
      houseBots: {
        chains: [
          {
            address: BOT,
            bet:
              bet ??
              (async (poolId, side, units) => {
                botCalls.push(`bet:${poolId}:${String(side)}:${String(units)}`);
                return "0xbotbet";
              }),
            claimFinished: async () => {
              botCalls.push("claim");
              return { digest: "0xbotclaim", tickets: 1 };
            },
          },
        ],
        stakeUnits: STAKE,
      },
    });
    const step = async (ms = 0): Promise<void> => {
      await harness.step(ms);
      await flushFightJob();
    };
    await step(60_000);
    assert.deepEqual(botCalls, [], "a bot never acts before a human starts the bout");
    await harness.loop.start();
    assert.ok(harness.loop.getState().poolId, "pool opens with the bout");
    return { ...harness, totals, botCalls, step };
  }

  it("bets against the human stake once the pool shows it, and claims after settle", async () => {
    const h = await botBout();
    await h.step(2_000);
    assert.deepEqual(h.botCalls, [], "no human stake and no video yet: the bot waits");

    h.totals[0] = 30_000n;
    await h.step(2_000);
    await h.step();
    const poolId = h.loop.getState().poolId;
    assert.deepEqual(h.botCalls, [`bet:${String(poolId)}:1:${String(STAKE)}`]);
    const state = h.loop.getState();
    assert.deepEqual(state.bots[0]?.bet, { side: 1, units: Number(STAKE), digest: "0xbotbet" });
    assert.deepEqual(state.pool, [30_000, Number(STAKE)]);

    await readyAlphaWin(h.loop, "bot-row");
    await startPlayback(h.loop);
    await h.step(5_000);
    await h.step(1);
    assert.equal(h.loop.getState().phase, "settle");
    await h.step();
    assert.deepEqual(h.botCalls.slice(1), ["claim"]);
  });

  it("with no human stake, bets a coin-flip side once the video is ready", async () => {
    const h = await botBout();
    await readyAlphaWin(h.loop, "bot-row");
    await h.step();
    assert.equal(h.botCalls.length, 1);
    assert.match(h.botCalls[0] ?? "", /:0:500000$/u);
  });

  it("does not bet at or after betting_closes_at", async () => {
    const h = await botBout();
    await readyAlphaWin(h.loop, "bot-row");
    await startPlayback(h.loop);
    await h.step(5_000);
    assert.deepEqual(h.botCalls, []);
    assert.equal(h.loop.getState().phase, "fight");
  });

  it("a failed bet shows on the bot, is not retried that bout, and the round goes on", async () => {
    let attempts = 0;
    const h = await botBout(async () => {
      attempts += 1;
      throw new Error("InsufficientGas");
    });
    await readyAlphaWin(h.loop, "bot-row");
    await h.step();
    await h.step(10_000);
    const state = h.loop.getState();
    assert.equal(attempts, 1);
    assert.match(
      state.bots[0]?.error ?? "",
      new RegExp(
        `House bot 0xb07 bet failed \\(battleId=${String(state.battleId)}, round 1\\): InsufficientGas`,
        "u",
      ),
    );
    assert.equal(state.error, null, "a bot failure is not a round failure");
    await startPlayback(h.loop);
    await h.step(5_000);
    assert.equal(h.loop.getState().phase, "fight");
  });

  it("bets against the larger human side", () => {
    assert.equal(botSide([10, 0], pickFirst), 1);
    assert.equal(botSide([0, 10], pickFirst), 0);
  });

  it("names HOUSE_BOT_SUI_PRIVATE_KEYS and HOUSE_BOT_STAKE_UNITS when missing or invalid", () => {
    const config = trackingBattleBetting([]).config;
    assert.throws(
      () => createHouseBotChains(config, 1_000, {}),
      /HOUSE_BOT_SUI_PRIVATE_KEYS is required\. .*\.env\.example/u,
    );
    assert.throws(
      () => readHouseBotStakeUnits({}),
      /HOUSE_BOT_STAKE_UNITS is required\. .*\.env\.example/u,
    );
    assert.throws(
      () => readHouseBotStakeUnits({ HOUSE_BOT_STAKE_UNITS: "0" }),
      /HOUSE_BOT_STAKE_UNITS must be at least 1/u,
    );
    assert.throws(
      () => readHouseBotStakeUnits({ HOUSE_BOT_STAKE_UNITS: "0.5" }),
      /HOUSE_BOT_STAKE_UNITS must be a whole number/u,
    );
  });
});
