import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildShotList, parseTimeRange } from "../src/shot-list.js";
import { sampleFightInput, validModelTurn } from "./fixtures.js";

describe("buildShotList", () => {
  it("gives each narrated shot's span both fighters, found by display name, else subname", () => {
    const input = sampleFightInput();
    delete input.fighterB.display_name;
    const cast = [
      { id: "A", name: "Freddy Krueger", find: "Freddy Krueger" },
      { id: "B", name: "jason", find: "jason" },
    ];

    assert.deepEqual(buildShotList(validModelTurn().shots, input), {
      shots: [
        { start_s: 0, end_s: 4, cast, props: [] },
        { start_s: 4, end_s: 8, cast, props: [] },
      ],
    });
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
