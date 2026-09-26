import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MemoryBattleQueueStore,
  type BattleQueueInsert,
  type ChainWritePorts,
} from "@horror-tube/fight/battle-queue";

import type { BattleBettingPorts } from "../src/battle-betting.js";
import type { FightJobRequest, FightJobResult } from "../src/fight-job.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
} from "../src/game/config.js";
import { MemoryRoundStore } from "../src/db/rounds.js";
import { GameLoop, StoreWriteError } from "../src/game/loop.js";

const baseConfig = {
  bettingCloseAfterVideoStartSeconds: 5,
  videoTimeoutSeconds: 300,
  settleSeconds: 8,
};

const labels = ["alpha", "bravo", "charlie", "delta"];

const allAliveStatuses = (ensLabels: string[]): string[] =>
  ensLabels.map(() => "alive");

function pinnedRandom(...draws: number[]): (maxExclusive: number) => number {
  let i = 0;
  return (maxExclusive: number) => {
    if (i >= draws.length) {
      throw new Error(
        `pinnedRandom exhausted after ${String(draws.length)} draws (maxExclusive=${String(maxExclusive)})`,
      );
    }
    const value = draws[i]!;
    i += 1;
    if (!Number.isInteger(value) || value < 0 || value >= maxExclusive) {
      throw new Error(
        `pinnedRandom draw ${String(value)} out of range for maxExclusive=${String(maxExclusive)}`,
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
  let nextId = 1;
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
    async openBattle(fighterA, fighterB, closesAtUnix) {
      const id = `battle-${String(nextId)}`;
      nextId += 1;
      calls.push(
        `open:${fighterA},${fighterB},${String(closesAtUnix)}→${id}`,
      );
      return id;
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
    rationale: "alpha wins",
    winnerSubname: "alpha",
    loserSubname: "bravo",
    winnerInjuries: ["cut"],
    nextOpponentSubname: "charlie",
    ...overrides,
  };
}

function unusedSettleDeps() {
  const calls: string[] = [];
  const betCalls: string[] = [];
  return {
    battleQueueStore: new MemoryBattleQueueStore(),
    roundStore: new MemoryRoundStore(),
    chainWritePorts: trackingPorts(calls),
    battleBetting: trackingBattleBetting(betCalls),
    fightJob: async () => new Promise(() => {}),
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

function makeLoop(
  overrides: {
    now?: () => number;
    randomInt?: (maxExclusive: number) => number;
    ensStatuses?: string[];
    ensLabels?: string[];
    config?: Partial<typeof baseConfig>;
    roundStore?: MemoryRoundStore;
    fightJob?: (
      request: FightJobRequest,
    ) => Promise<FightJobResult>;
    settle?: ReturnType<typeof unusedSettleDeps>;
  } = {},
): { loop: GameLoop; settle: ReturnType<typeof unusedSettleDeps> } {
  const settle = overrides.settle ?? unusedSettleDeps();
  const ensLabels = overrides.ensLabels ?? labels;
  const loop = new GameLoop({
    config: { ...baseConfig, ...overrides.config },
    ensLabels,
    ensStatuses: overrides.ensStatuses ?? allAliveStatuses(ensLabels),
    now: overrides.now,
    randomInt: overrides.randomInt ?? pinnedRandom(0, 0),
    battleQueueStore: settle.battleQueueStore,
    roundStore: overrides.roundStore ?? settle.roundStore,
    chainWritePorts: settle.chainWritePorts,
    battleBetting: settle.battleBetting,
    fightJob: overrides.fightJob ?? settle.fightJob,
  });
  return { loop, settle };
}

describe("game loop config", () => {
  it("throws and names each timing variable when missing", () => {
    assert.throws(
      () => readGameLoopConfig({}),
      /BETTING_CLOSE_AFTER_VIDEO_START_SECONDS is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("reads timings when present", () => {
    const cfg = readGameLoopConfig({
      BETTING_CLOSE_AFTER_VIDEO_START_SECONDS: "5",
      VIDEO_TIMEOUT_SECONDS: "300",
      SETTLE_SECONDS: "8",
    });
    assert.deepEqual(cfg, {
      bettingCloseAfterVideoStartSeconds: 5,
      videoTimeoutSeconds: 300,
      settleSeconds: 8,
    });
  });

  it("requires ROSTER_ENS_LABELS with at least two labels", () => {
    assert.throws(() => readRosterEnsLabels({}), /ROSTER_ENS_LABELS/u);
    assert.deepEqual(
      readRosterEnsLabels({ ROSTER_ENS_LABELS: "zebra,alpha,bravo" }),
      ["alpha", "bravo", "zebra"],
    );
  });
});

describe("fresh bout (random pair)", () => {
  it("picks a random living first fighter then a random living opponent via nextRotationPair", async () => {
    const settle = unusedSettleDeps();
    const { loop } = makeLoop({
      settle,
      randomInt: pinnedRandom(1, 0),
    });
    await loop.startFreshBout();
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().champion, null);
    assert.deepEqual(loop.getState().fighters, [1, 0]);
    assert.ok(
      settle.betCalls.some((c) => c.startsWith("open:bravo,alpha,")),
      `expected openBattle for bravo vs alpha, got ${JSON.stringify(settle.betCalls)}`,
    );
  });

  it("never chooses a dead fighter as the first draw", async () => {
    const settle = unusedSettleDeps();
    const { loop } = makeLoop({
      settle,
      ensStatuses: ["alive", "dead", "alive", "alive"],
      randomInt: pinnedRandom(1, 1),
    });
    await loop.startFreshBout();
    assert.deepEqual(loop.getState().fighters, [2, 3]);
    assert.equal(loop.getState().chars[1]?.alive, false);
  });

  it("lets nextRotationPair refuse when fewer than 2 living remain", async () => {
    const { loop } = makeLoop({
      ensLabels: ["alpha", "bravo"],
      ensStatuses: ["alive", "dead"],
      randomInt: pinnedRandom(0),
    });
    await assert.rejects(() => loop.startFreshBout(), /fewer than 2 living/u);
  });

  it("ends a leftover open season from a previous process then starts a new one", async () => {
    const store = new MemoryRoundStore();
    await store.startSeason([
      { ensLabel: "alpha", alive: true, kills: 0, damage: 0 },
      { ensLabel: "bravo", alive: true, kills: 0, damage: 0 },
    ]);
    assert.equal(await store.findOpenSeasonId(), "season-1");
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    try {
      const { loop } = makeLoop({
        roundStore: store,
        randomInt: pinnedRandom(0, 0),
      });
      await loop.startFreshBout();
      assert.equal(loop.getState().phase, "bet");
      assert.equal(await store.findOpenSeasonId(), "season-2");
      assert.ok(store.seasonEnded.has("season-1"));
      assert.match(warns.join("\n"), /ending leftover open season season-1/u);
    } finally {
      console.warn = orig;
    }
  });

  it("requires randomInt before opening a rotation pair", async () => {
    const settle = unusedSettleDeps();
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      ensStatuses: allAliveStatuses(labels),
      battleQueueStore: settle.battleQueueStore,
      roundStore: new MemoryRoundStore(),
      chainWritePorts: settle.chainWritePorts,
      battleBetting: settle.battleBetting,
      fightJob: settle.fightJob,
    });
    await assert.rejects(() => loop.startFreshBout(), /randomInt was not provided/u);
  });
});

describe("GameLoop ENS status", () => {
  it("starts dead labels not alive", () => {
    const { loop } = makeLoop({
      ensStatuses: ["alive", "dead", "alive", "alive"],
    });
    assert.equal(loop.getState().chars[1]?.alive, false);
  });

  it("throws naming the label and value for unknown status", () => {
    const settle = unusedSettleDeps();
    assert.throws(
      () =>
        new GameLoop({
          config: baseConfig,
          ensLabels: labels,
          ensStatuses: ["alive", "ghost", "alive", "alive"],
          randomInt: pinnedRandom(0, 0),
          battleQueueStore: settle.battleQueueStore,
          roundStore: new MemoryRoundStore(),
          chainWritePorts: settle.chainWritePorts,
          battleBetting: settle.battleBetting,
          fightJob: settle.fightJob,
        }),
      /bravo.*ghost|ghost.*bravo/u,
    );
  });
});

describe("GameLoop phases", () => {
  it("opens a fresh bout then fight→settle→next bet via rotation", async () => {
    let now = 1_000_000;
    const settle = unusedSettleDeps();
    const { loop } = makeLoop({
      settle,
      now: () => now,
      randomInt: pinnedRandom(1, 0, 0),
      config: { bettingCloseAfterVideoStartSeconds: 2, settleSeconds: 3 },
    });
    await loop.startFreshBout();
    assert.deepEqual(loop.getState().fighters, [1, 0]);

    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    loop.setPool(battleId, `0xpool-${battleId}`, [20000, 0]);
    await loop.attachAgentResult({
      id: "r1",
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
      ensLines: ["alpha|status=dead", 'bravo|injuries=["cut"]'],
      rationale: "bravo wins",
      winnerSubname: "bravo",
      loserSubname: "alpha",
      winnerInjuries: ["cut"],
      nextOpponentSubname: "charlie",
    });
    loop.setOutcome(0, 3);
    loop.setVideoReady(
      "https://cdn.example/videos/fight1.mp4",
      4_000,
      "https://cdn.example/frames/fight1.jpg",
    );
    await startPlayback(loop);
    now += 2_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "fight");
    now += 4_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
    assert.equal(loop.getState().champion, 1);
    assert.equal(loop.getState().chars[0]?.alive, false);
    now += 3_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().round, 2);
    assert.deepEqual(loop.getState().fighters, [1, 2]);
  });

  it("after failVideo cancels the Sui pool and leaves bet for over", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const { loop } = makeLoop({
      settle,
      now: () => now,
      randomInt: pinnedRandom(0, 0),
      config: { videoTimeoutSeconds: 5 },
    });
    await loop.startFreshBout();
    const battleId = loop.getState().battleId;
    assert.ok(battleId);
    await loop.failVideo("fal render failed: timeout");
    assert.equal(loop.getState().phase, "over");
    assert.equal(loop.getState().error, "fal render failed: timeout");
    assert.ok(settle.betCalls.some((c) => c === `cancel:${battleId}`));
    assert.equal(await settle.roundStore.findOpenSeasonId(), null);
  });

  it("fight job success attaches result and sets video + outcome", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const requests: FightJobRequest[] = [];
    const { loop } = makeLoop({
      settle,
      now: () => now,
      randomInt: pinnedRandom(0, 0),
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
    await loop.startFreshBout();
    assert.deepEqual(loop.getState().fighters, [0, 1]);
    await flushFightJob();
    assert.equal(requests.length, 1);
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/job.mp4");
  });

  it("a late fight job result is not applied to the next bout", async () => {
    let now = 0;
    const settle = unusedSettleDeps();
    const requests: FightJobRequest[] = [];
    const pending: Array<(result: FightJobResult) => void> = [];
    const { loop } = makeLoop({
      settle,
      now: () => now,
      randomInt: pinnedRandom(0, 0, 0, 0),
      config: { videoTimeoutSeconds: baseConfig.videoTimeoutSeconds },
      fightJob: (request) => {
        requests.push(request);
        return new Promise((resolve) => pending.push(resolve));
      },
    });
    await loop.startFreshBout();
    now += baseConfig.videoTimeoutSeconds * 1_000;
    await loop.tick(now);
    assert.equal(loop.getState().phase, "over");

    await loop.startFreshBout();
    assert.equal(loop.getState().phase, "bet");
    await flushFightJob();
    assert.deepEqual(
      requests.map((r) => r.battleId),
      ["battle-1", "battle-2"],
    );

    pending[0]?.({
      insert: agentInsertForAlphaWin({ id: "late-r1", battleId: "battle-1" }),
      winnerSide: 0,
      damage: 1,
      videoUrl: "https://cdn.example/videos/late.mp4",
      durationMs: 1_000,
      frameUrl: "https://cdn.example/frames/late.jpg",
    });
    await flushFightJob();
    assert.equal(loop.getState().videoUrl, null);
    assert.equal(loop.getState().error, null);
  });
});

describe("betting cutoff", () => {
  const VIDEO_MS = 8_000;

  async function readyBout(
    overrides: { battleBetting?: BattleBettingPorts; battleQueueStore?: MemoryBattleQueueStore } = {},
  ) {
    const clock = { now: 1_000_000 };
    const settle = unusedSettleDeps();
    if (overrides.battleBetting) settle.battleBetting = overrides.battleBetting;
    if (overrides.battleQueueStore) settle.battleQueueStore = overrides.battleQueueStore;
    const { loop } = makeLoop({
      settle,
      now: () => clock.now,
      randomInt: pinnedRandom(0, 0),
    });
    await loop.startFreshBout();
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

  it("stores betting_closes_at from playback start and rejects bets at it", async () => {
    const { loop, clock, poolId } = await readyBout();
    const startedAt = clock.now + 30_000;
    clock.now = startedAt;
    await startPlayback(loop);
    const closesAt = startedAt + baseConfig.bettingCloseAfterVideoStartSeconds * 1_000;
    assert.equal(loop.getState().bettingClosesAt, closesAt);
    clock.now = closesAt;
    const iso = new Date(closesAt).toISOString();
    assert.throws(() => loop.assertBetAllowed(poolId), new RegExp(`bet rejected: betting closed at ${iso}`, "u"));
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "fight");
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
      (err: unknown) =>
        err instanceof StoreWriteError &&
        err.message.includes(`battle ${String(battleId)}`) &&
        err.message.includes("disk full"),
    );
    assert.equal(loop.getState().bettingClosesAt, null);
    clock.now += 60_000;
    await loop.tick(clock.now);
    assert.equal(loop.getState().phase, "bet");
  });
});
