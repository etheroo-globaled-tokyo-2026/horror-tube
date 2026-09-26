import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

/** Pin challenger to the first living non-winner. */
const pickFirst = () => 0;

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
});

describe("World ID vote gate", () => {
  it("refuses unverified votes by default", async () => {
    await assert.rejects(
      () => refuseUnverifiedWorldId({}),
      /World ID verification is not available/u,
    );
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      randomInt: pickFirst,
    });
    await assert.rejects(
      () => loop.vote({ fake: true }, [0, 1]),
      /World ID verification is not available/u,
    );
  });
});

describe("GameLoop phases", () => {
  it("waits in vote until quorum, then countdown, then bet→fight→settle→next bet via rotation", async () => {
    let now = 1_000_000;
    let nullifierSeq = 0;
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 2,
        voteCountdownSeconds: 5,
        betMinSeconds: 2,
        settleSeconds: 3,
      },
      ensLabels: labels,
      now: () => now,
      randomInt: pickFirst,
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
    loop.tick(now);
    assert.equal(loop.getState().phase, "bet");
    assert.ok(loop.getState().fighters);
    // votes: 0→1, 1→2, 2→1 → top are 1 then 0
    assert.deepEqual(loop.getState().fighters, [1, 0]);

    loop.bet(0, 1.5);
    assert.deepEqual(loop.getState().pool, [1.5, 0]);

    loop.setOutcome(0, 3);
    loop.setVideoReady("https://cdn.example/videos/fight1.mp4", 4_000);
    assert.equal(loop.getState().phase, "bet");
    now += 2_000;
    loop.tick(now);
    assert.equal(loop.getState().phase, "fight");
    assert.equal(loop.getState().videoUrl, "https://cdn.example/videos/fight1.mp4");

    now += 4_000;
    loop.tick(now);
    assert.equal(loop.getState().phase, "settle");
    assert.equal(loop.getState().winner, 0);
    assert.equal(loop.getState().champion, 1);
    assert.equal(loop.getState().chars[0]?.alive, false);
    assert.equal(loop.getState().chars[1]?.kills, 1);
    assert.equal(loop.getState().chars[1]?.damage, 3);

    now += 3_000;
    loop.tick(now);
    // Stage 2+: no challenger ballot — next bout opens from nextRotationPair.
    assert.equal(loop.getState().phase, "bet");
    assert.equal(loop.getState().round, 2);
    assert.equal(loop.getState().champion, 1);
    // Living non-winners in id order: charlie(2), delta(3). pickFirst → charlie.
    assert.deepEqual(loop.getState().fighters, [1, 2]);
  });

  it("rejects duplicate nullifier and dead picks in stage 1", async () => {
    let now = 0;
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 2,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      now: () => now,
      randomInt: pickFirst,
      verifyWorldId: async () => ({ nullifier: "same" }),
    });
    await loop.vote({}, [0, 1]);
    await assert.rejects(() => loop.vote({}, [2, 3]), /already voted/u);

    let n = 0;
    const loop2 = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      now: () => now,
      randomInt: pickFirst,
      verifyWorldId: async () => {
        n += 1;
        return { nullifier: `uniq-${String(n)}` };
      },
    });
    await loop2.vote({}, [0, 1]);
    now += 1_000;
    loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    loop2.setOutcome(0, 0);
    loop2.setVideoReady("https://cdn.example/v.mp4", 1);
    now += 1_000;
    loop2.tick(now);
    now += 1;
    loop2.tick(now);
    now += 1_000;
    loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    assert.equal(loop2.getState().champion, 0);
    // Winner alpha(0); living non-winners charlie,delta (bravo dead) → pickFirst → charlie(2)
    assert.deepEqual(loop2.getState().fighters, [0, 2]);
    assert.equal(loop2.getState().chars[1]?.alive, false);
  });

  it("rejects bet outside bet phase and empty video url", async () => {
    const loop = new GameLoop({
      config: baseConfig,
      ensLabels: labels,
      randomInt: pickFirst,
      verifyWorldId: async () => ({ nullifier: "x" }),
    });
    assert.throws(() => loop.bet(0, 1), /bet phase/u);
    let now = 0;
    const loop2 = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
      },
      ensLabels: labels,
      now: () => now,
      randomInt: pickFirst,
      verifyWorldId: async () => ({ nullifier: "y" }),
    });
    await loop2.vote({}, [0, 1]);
    now += 1_000;
    loop2.tick(now);
    assert.equal(loop2.getState().phase, "bet");
    assert.throws(() => loop2.setVideoReady("  ", 1000), /non-empty/u);
  });

  it("requires randomInt before starting a stage-2 bout", async () => {
    let now = 0;
    const loop = new GameLoop({
      config: {
        ...baseConfig,
        quorumVotes: 1,
        voteCountdownSeconds: 1,
        betMinSeconds: 1,
        settleSeconds: 1,
      },
      ensLabels: labels,
      now: () => now,
      verifyWorldId: async () => ({ nullifier: "z" }),
    });
    await loop.vote({}, [0, 1]);
    now += 1_000;
    loop.tick(now);
    loop.setOutcome(0, 0);
    loop.setVideoReady("https://cdn.example/v.mp4", 1);
    now += 1_000;
    loop.tick(now);
    now += 1;
    loop.tick(now);
    now += 1_000;
    assert.throws(() => loop.tick(now), /randomInt was not provided/u);
  });
});
