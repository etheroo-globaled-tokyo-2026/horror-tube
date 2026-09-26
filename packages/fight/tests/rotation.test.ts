import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextRotationPair,
  type RosterEntry,
} from "../src/rotation.js";

function roster(
  ...rows: Array<[string, "alive" | "dead"]>
): RosterEntry[] {
  return rows.map(([subname, status]) => ({ subname, status }));
}

describe("nextRotationPair", () => {
  it("keeps the winner as champion and picks the next living after them", () => {
    const pair = nextRotationPair(
      roster(
        ["freddy", "alive"],
        ["jason", "alive"],
        ["leatherface", "alive"],
        ["chucky", "alive"],
      ),
      "jason",
    );
    assert.deepEqual(pair, {
      championSubname: "jason",
      challengerSubname: "leatherface",
    });
  });

  it("skips dead characters when choosing the challenger", () => {
    const pair = nextRotationPair(
      roster(
        ["freddy", "dead"],
        ["jason", "alive"],
        ["leatherface", "dead"],
        ["chucky", "alive"],
      ),
      "jason",
    );
    assert.deepEqual(pair, {
      championSubname: "jason",
      challengerSubname: "chucky",
    });
  });

  it("wraps to the start of the roster for the next living challenger", () => {
    const pair = nextRotationPair(
      roster(
        ["freddy", "alive"],
        ["jason", "alive"],
        ["leatherface", "dead"],
      ),
      "jason",
    );
    assert.deepEqual(pair, {
      championSubname: "jason",
      challengerSubname: "freddy",
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
        ),
      /fewer than 2 living|no fight|only/i,
    );
  });

  it("rejects a dead or missing winner", () => {
    assert.throws(
      () =>
        nextRotationPair(
          roster(["freddy", "alive"], ["jason", "dead"]),
          "jason",
        ),
      /must be alive/,
    );
    assert.throws(
      () =>
        nextRotationPair(
          roster(["freddy", "alive"], ["jason", "alive"]),
          "pinhead",
        ),
      /missing from the roster/,
    );
  });
});
