import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextRotationPair,
  rosterAfterFight,
  type RandomInt,
  type RosterEntry,
} from "../src/rotation.js";

function roster(
  ...rows: Array<[string, "alive" | "dead"]>
): RosterEntry[] {
  return rows.map(([subname, status]) => ({ subname, status }));
}

const pickFirst: RandomInt = (maxExclusive) => {
  assert.ok(maxExclusive > 0);
  return 0;
};

const pickLast: RandomInt = (maxExclusive) => {
  assert.ok(maxExclusive > 0);
  return maxExclusive - 1;
};

describe("nextRotationPair", () => {
  it("keeps the winner as champion", () => {
    const pair = nextRotationPair(
      roster(
        ["freddy", "alive"],
        ["jason", "alive"],
        ["leatherface", "alive"],
        ["chucky", "alive"],
      ),
      "jason",
      pickFirst,
    );
    assert.equal(pair.championSubname, "jason");
  });

  it("picks the opponent from living non-winners via the injected random source", () => {
    const rows = roster(
      ["freddy", "alive"],
      ["jason", "alive"],
      ["leatherface", "alive"],
      ["chucky", "alive"],
    );
    assert.deepEqual(nextRotationPair(rows, "jason", pickFirst), {
      championSubname: "jason",
      challengerSubname: "freddy",
    });
    assert.deepEqual(nextRotationPair(rows, "jason", pickLast), {
      championSubname: "jason",
      challengerSubname: "chucky",
    });
    assert.deepEqual(nextRotationPair(rows, "jason", () => 1), {
      championSubname: "jason",
      challengerSubname: "leatherface",
    });
  });

  it("skips dead characters when choosing the challenger", () => {
    const rows = roster(
      ["freddy", "dead"],
      ["jason", "alive"],
      ["leatherface", "dead"],
      ["chucky", "alive"],
      ["pinhead", "alive"],
    );
    assert.deepEqual(nextRotationPair(rows, "jason", pickFirst), {
      championSubname: "jason",
      challengerSubname: "chucky",
    });
    assert.deepEqual(nextRotationPair(rows, "jason", pickLast), {
      championSubname: "jason",
      challengerSubname: "pinhead",
    });
  });

  it("does not start a fight when only one living character remains", () => {
    assert.throws(
      () =>
        nextRotationPair(
          roster(
            ["freddy", "dead"],
            ["jason", "alive"],
            ["leatherface", "dead"],
          ),
          "jason",
          pickFirst,
        ),
      /fewer than 2 living|no fight|only/i,
    );
  });

  it("rejects a dead winner", () => {
    assert.throws(
      () =>
        nextRotationPair(
          roster(
            ["freddy", "alive"],
            ["jason", "dead"],
            ["leatherface", "alive"],
          ),
          "jason",
          pickFirst,
        ),
      /must be alive/,
    );
  });

  it("rejects a missing winner", () => {
    assert.throws(
      () =>
        nextRotationPair(
          roster(["freddy", "alive"], ["jason", "alive"]),
          "pinhead",
          pickFirst,
        ),
      /missing from the roster/,
    );
  });

  it("rejects a randomInt result outside the challenger range", () => {
    assert.throws(
      () =>
        nextRotationPair(
          roster(["freddy", "alive"], ["jason", "alive"]),
          "jason",
          () => 1,
        ),
      /randomInt|\[0,/i,
    );
  });
});

describe("rosterAfterFight", () => {
  it("marks the loser dead and keeps other living entries", () => {
    assert.deepEqual(
      rosterAfterFight(
        [{ subname: "freddy" }, { subname: "jason" }],
        [{ subname: "leatherface" }, { subname: "chucky" }],
        "freddy",
        "jason",
      ),
      [
        { subname: "freddy", status: "dead" },
        { subname: "jason", status: "alive" },
        { subname: "leatherface", status: "alive" },
        { subname: "chucky", status: "alive" },
      ],
    );
  });
});
