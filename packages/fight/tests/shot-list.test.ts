import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { FightError } from "../src/env.js";
import { buildShotList, parseTimeRange, SEARCH_PHRASES } from "../src/shot-list.js";
import { sampleFightInput, validModelTurn } from "./fixtures.js";

const rosterCards: { label: string }[] = JSON.parse(
  readFileSync(new URL("../../roster/roster/ens-text-snapshot.json", import.meta.url), "utf8"),
);

describe("SEARCH_PHRASES", () => {
  it("has a phrase for every fighter on the roster", () => {
    const missing = rosterCards
      .map((card) => card.label)
      .filter((subname) => !SEARCH_PHRASES.has(subname));
    assert.deepEqual(missing, []);
  });

  it("gives no two fighters the same phrase", () => {
    const phrases = [...SEARCH_PHRASES.values()];
    assert.equal(new Set(phrases).size, phrases.length);
  });
});

describe("buildShotList", () => {
  it("gives each narrated shot's span both fighters, named from their card and found by their phrase", () => {
    const input = sampleFightInput();
    delete input.fighterB.display_name;
    const cast = [
      { id: "A", name: "Freddy Krueger", find: SEARCH_PHRASES.get("freddy") },
      { id: "B", name: "jason", find: SEARCH_PHRASES.get("jason") },
    ];

    assert.deepEqual(buildShotList(validModelTurn().shots, input), {
      shots: [
        { start_s: 0, end_s: 4, cast, props: [] },
        { start_s: 4, end_s: 8, cast, props: [] },
      ],
    });
  });

  it("names a fighter it has no phrase for", () => {
    const input = sampleFightInput();
    input.fighterA.subname = "maskcoat";
    assert.throws(
      () => buildShotList(validModelTurn().shots, input),
      (err: unknown) => {
        assert.ok(err instanceof FightError);
        assert.match(err.message, /no rotoscope search phrase for fighter "maskcoat"/);
        return true;
      },
    );
  });
});

describe("parseTimeRange", () => {
  it("reads seconds from the forms a model writes", () => {
    const forms: [string, number, number][] = [
      ["0-4s", 0, 4],
      ["4.5–8 s", 4.5, 8],
      ["2s - 6s", 2, 6],
    ];
    for (const [text, start_s, end_s] of forms) {
      assert.deepEqual(parseTimeRange(text), { start_s, end_s }, text);
    }
  });

  it("rejects a range it can't read or that ends before it starts", () => {
    assert.throws(() => parseTimeRange("the opening"), /"the opening" is not seconds/);
    assert.throws(() => parseTimeRange("6-2s"), /ends before it starts/);
  });
});
