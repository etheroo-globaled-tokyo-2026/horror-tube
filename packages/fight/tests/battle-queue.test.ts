import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createQueuedRecord,
  markBettingClosed,
  markPlaybackFinished,
  MemoryBattleQueueStore,
  nextSettleStep,
  parseInjuriesTextRecord,
  settleQueuedBattle,
  type BattleQueueInsert,
  type BattleQueueRecord,
  type ChainWritePorts,
} from "../src/battle-queue.js";
import { validModelTurn } from "./fixtures.js";

function sampleInsert(overrides: Partial<BattleQueueInsert> = {}): BattleQueueInsert {
  const turn = validModelTurn();
  return {
    id: "queue-1",
    battleId: "42",
    fighterASubname: "jason",
    fighterBSubname: "freddy",
    shots: turn.shots,
    ensLines: [
      `${turn.loser_subname}|status=dead`,
      `${turn.winner_subname}|injuries=${JSON.stringify(turn.winner_injuries)}`,
    ],
    rationale: turn.rationale,
    winnerSubname: turn.winner_subname,
    loserSubname: turn.loser_subname,
    winnerInjuries: turn.winner_injuries,
    ...overrides,
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

describe("createQueuedRecord", () => {
  it("starts with gates false and no tx hashes (zero bets is valid)", () => {
    const row = createQueuedRecord(sampleInsert());
    assert.equal(row.bettingClosed, false);
    assert.equal(row.playbackFinished, false);
    assert.equal(row.injuriesTxHash, null);
    assert.equal(row.statusTxHash, null);
    assert.equal(row.settlementTxHash, null);
    assert.equal(nextSettleStep(row), "injuries");
  });
});

describe("settle gates", () => {
  it("performs zero writes when betting is still open", async () => {
    const store = new MemoryBattleQueueStore();
    const calls: string[] = [];
    let row = createQueuedRecord(sampleInsert());
    row = markPlaybackFinished(row);
    await store.save(row);
    await assert.rejects(() => settleQueuedBattle(row, trackingPorts(calls), store), {
      name: "BattleQueueError",
      message: /betting-closed signal is missing/u,
    });
    assert.deepEqual(calls, []);
    const saved = await store.get(row.id);
    assert.equal(saved?.injuriesTxHash, null);
  });

  it("performs zero writes when playback has not finished", async () => {
    const store = new MemoryBattleQueueStore();
    const calls: string[] = [];
    let row = createQueuedRecord(sampleInsert());
    row = markBettingClosed(row);
    await store.save(row);
    await assert.rejects(() => settleQueuedBattle(row, trackingPorts(calls), store), {
      name: "BattleQueueError",
      message: /playback-finished signal is missing/u,
    });
    assert.deepEqual(calls, []);
  });
});

describe("settleQueuedBattle", () => {
  it("writes injuries, then status, then settlement when both gates are set", async () => {
    const store = new MemoryBattleQueueStore();
    const calls: string[] = [];
    let row = createQueuedRecord(sampleInsert());
    row = markBettingClosed(markPlaybackFinished(row));
    await store.save(row);
    const done = await settleQueuedBattle(row, trackingPorts(calls), store);
    assert.deepEqual(calls, ["injuries", "status", "settle:42"]);
    assert.equal(done.injuriesTxHash, "0xinjuries");
    assert.equal(done.statusTxHash, "0xstatus");
    assert.equal(done.settlementTxHash, "0xsettle");
    assert.equal(nextSettleStep(done), "next_bout");
  });

  it("surfaces a failed pool settle with the battle id and resumes only at settleBattle", async () => {
    const store = new MemoryBattleQueueStore();
    let row = createQueuedRecord(sampleInsert());
    row = markBettingClosed(markPlaybackFinished(row));
    await store.save(row);
    const failing: ChainWritePorts = {
      ...trackingPorts([]),
      async settleBattle() {
        throw new Error("pool 0xpool settle aborted");
      },
    };
    await assert.rejects(
      () => settleQueuedBattle(row, failing, store),
      /settle step settlement failed \(battleId=42\)\. pool 0xpool settle aborted/u,
    );
    const saved = await store.get(row.id);
    assert.ok(saved);
    assert.equal(saved.statusTxHash, "0xstatus");
    assert.equal(saved.settlementTxHash, null);

    const resumeCalls: string[] = [];
    const done = await settleQueuedBattle(saved, trackingPorts(resumeCalls), store);
    assert.deepEqual(resumeCalls, ["settle:42"]);
    assert.equal(done.settlementTxHash, "0xsettle");
  });

  it("resumes after a confirmed injuries write and does not repeat it", async () => {
    const store = new MemoryBattleQueueStore();
    const calls: string[] = [];
    let row: BattleQueueRecord = {
      ...createQueuedRecord(sampleInsert()),
      bettingClosed: true,
      playbackFinished: true,
      injuriesTxHash: "0xalready-injuries",
    };
    await store.save(row);
    const done = await settleQueuedBattle(row, trackingPorts(calls), store);
    assert.deepEqual(calls, ["status", "settle:42"]);
    assert.equal(done.injuriesTxHash, "0xalready-injuries");
    assert.equal(done.statusTxHash, "0xstatus");
    assert.equal(done.settlementTxHash, "0xsettle");
  });

  it("leaves a partial failure pending and does not continue", async () => {
    const store = new MemoryBattleQueueStore();
    let row = createQueuedRecord(sampleInsert());
    row = markBettingClosed(markPlaybackFinished(row));
    await store.save(row);
    const ports: ChainWritePorts = {
      async writeWinnerInjuries() {
        return "0xinjuries-ok";
      },
      async writeLoserStatusDead() {
        throw new Error("rpc timeout on status write");
      },
      async settleBattle(_battleId, _side) {
        return "0xshould-not-run";
      },
    };
    await assert.rejects(
      () => settleQueuedBattle(row, ports, store),
      /settle step status failed.*rpc timeout/u,
    );
    const saved = await store.get(row.id);
    assert.equal(saved?.injuriesTxHash, "0xinjuries-ok");
    assert.equal(saved?.statusTxHash, null);
    assert.equal(saved?.settlementTxHash, null);
  });
});

describe("parseInjuriesTextRecord", () => {
  it("accepts a JSON array and refuses empty or non-array encodings", () => {
    assert.deepEqual(parseInjuriesTextRecord("[]"), []);
    assert.deepEqual(parseInjuriesTextRecord('["cut"]'), ["cut"]);
    assert.throws(() => parseInjuriesTextRecord(""), /injuries text record is ""/u);
    assert.throws(() => parseInjuriesTextRecord("scarred"), /not JSON|must be a JSON array/u);
    assert.throws(() => parseInjuriesTextRecord('"scarred"'), /must be a JSON array/u);
  });
});
describe("battle video URL store", () => {
  it("rejects blank and fal.media URLs; accepts a Spaces CDN URL and lists it later", async () => {
    const store = new MemoryBattleQueueStore();
    const row = createQueuedRecord(sampleInsert({ id: "vid-1" }));
    await store.save(row);

    await assert.rejects(() => store.setVideoUrl(row.id, "  "), /blank/u);
    await assert.rejects(
      () => store.setVideoUrl(row.id, "https://v3b.fal.media/files/b/fight.mp4"),
      /fal\.media/u,
    );
    await assert.rejects(
      () => store.setVideoUrl(row.id, "https://fal.media/files/fight.mp4"),
      /fal\.media/u,
    );

    const cdn = "https://fight-media.example/videos/abc.mp4";
    await store.setVideoUrl(row.id, cdn);
    const recorded = await store.listRecorded();
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.videoUrl, cdn);
  });

  it("lists recorded bouts oldest first, unaffected by a later write to an older bout", async () => {
    const store = new MemoryBattleQueueStore();
    assert.deepEqual(await store.listRecorded(), []);

    const older = createQueuedRecord(sampleInsert({ id: "vid-old", battleId: "1" }));
    const newer = createQueuedRecord(sampleInsert({ id: "vid-new", battleId: "2" }));
    await store.save(older);
    await store.setVideoUrl(older.id, "https://cdn.example/videos/old.mp4");
    await store.save(newer);
    await store.setVideoUrl(newer.id, "https://cdn.example/videos/new.mp4");
    await store.save(markBettingClosed(older));
    await store.setVideoUrl(older.id, "https://cdn.example/videos/old.mp4");

    const recorded = await store.listRecorded();
    assert.deepEqual(
      recorded.map((r) => r.battleId),
      ["1", "2"],
    );
    assert.deepEqual(
      recorded.map((r) => r.videoUrl),
      ["https://cdn.example/videos/old.mp4", "https://cdn.example/videos/new.mp4"],
    );
  });

  it("excludes rows that never had a video URL set", async () => {
    const store = new MemoryBattleQueueStore();
    const withVideo = createQueuedRecord(sampleInsert({ id: "vid-yes", battleId: "1" }));
    const withoutVideo = createQueuedRecord(sampleInsert({ id: "vid-no", battleId: "2" }));
    await store.save(withVideo);
    await store.setVideoUrl(withVideo.id, "https://cdn.example/videos/yes.mp4");
    await store.save(withoutVideo);

    const recorded = await store.listRecorded();
    assert.deepEqual(
      recorded.map((r) => r.battleId),
      ["1"],
    );
  });

  it("fails when the battle_results row is missing", async () => {
    const store = new MemoryBattleQueueStore();
    await assert.rejects(
      () => store.setVideoUrl("missing-id", "https://cdn.example/videos/x.mp4"),
      /battle_results row.*"missing-id".*missing/u,
    );
  });
});
