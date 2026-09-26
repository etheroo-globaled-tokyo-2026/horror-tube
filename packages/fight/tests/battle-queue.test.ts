import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BattleQueueError,
  createQueuedRecord,
  fightInputFromQueuedNext,
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
import {
  fighterA,
  fighterB,
  livingOpponent,
  otherLiving,
  validTurn,
} from "./fixtures.js";

function sampleInsert(
  overrides: Partial<BattleQueueInsert> = {},
): BattleQueueInsert {
  const turn = validTurn();
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
    nextOpponentSubname: turn.next_opponent_subname,
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
    await assert.rejects(
      () => settleQueuedBattle(row, trackingPorts(calls), store),
      (err: unknown) => {
        assert.ok(err instanceof BattleQueueError);
        assert.match(err.message, /betting-closed signal is missing/u);
        return true;
      },
    );
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
    await assert.rejects(
      () => settleQueuedBattle(row, trackingPorts(calls), store),
      (err: unknown) => {
        assert.ok(err instanceof BattleQueueError);
        assert.match(err.message, /playback-finished signal is missing/u);
        return true;
      },
    );
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
    assert.throws(
      () => parseInjuriesTextRecord(""),
      /injuries text record is ""/u,
    );
    assert.throws(
      () => parseInjuriesTextRecord("scarred"),
      /not JSON|must be a JSON array/u,
    );
    assert.throws(
      () => parseInjuriesTextRecord('"scarred"'),
      /must be a JSON array/u,
    );
  });
});

describe("fightInputFromQueuedNext", () => {
  it("builds the following bout from the winner and stored opponent", () => {
    const living = [fighterA, fighterB, livingOpponent, otherLiving];
    const input = fightInputFromQueuedNext(living, "jason", "leatherface");
    assert.equal(input.fighterA.subname, "jason");
    assert.equal(input.fighterB.subname, "leatherface");
    assert.deepEqual(
      input.eligibleOpponents.map((c) => c.subname),
      ["freddy", "chucky"],
    );
  });

  it("aborts when the stored opponent is missing or dead", () => {
    const living = [fighterA, fighterB];
    assert.throws(
      () => fightInputFromQueuedNext(living, "jason", "missing"),
      /next opponent.*"missing".*missing or not alive/u,
    );
    assert.throws(
      () => fightInputFromQueuedNext(living, "jason", "jason"),
      /must not be the winner/u,
    );
  });
});
