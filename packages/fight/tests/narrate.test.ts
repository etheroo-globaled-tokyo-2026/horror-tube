import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertTurnContractText, narrateFight } from "../src/narrate.js";
import { renderEnsLines } from "../src/render.js";
import { sampleFightInput, validTurn } from "./fixtures.js";
import type { NarrationConfig } from "../src/env.js";

const narrationCfg: NarrationConfig = {
  provider: "anthropic",
  model: "claude-test",
  fightVideoSeconds: 8,
  apiKey: "sk-test",
};

describe("assertTurnContractText", () => {
  it("accepts loser line then winner line with nothing after", () => {
    const turn = validTurn();
    const [loser, winner] = renderEnsLines(turn);
    assert.doesNotThrow(() =>
      assertTurnContractText(`${loser}\n${winner}`, turn),
    );
  });

  it("rejects when the winner line is not last", () => {
    const turn = validTurn();
    const [loser, winner] = renderEnsLines(turn);
    assert.throws(
      () => assertTurnContractText(`${winner}\n${loser}`, turn),
      /winner.*last|not last/i,
    );
  });

  it("rejects extra trailing lines after the ENS pair", () => {
    const turn = validTurn();
    const [loser, winner] = renderEnsLines(turn);
    assert.throws(
      () => assertTurnContractText(`${loser}\n${winner}\nextra`, turn),
      /extra|trailing/i,
    );
  });

  it("rejects look/brief/icon field updates in the ENS lines", () => {
    const turn = validTurn();
    assert.throws(
      () =>
        assertTurnContractText(
          "freddy|status=dead\njason|look=new face",
          turn,
        ),
      /look|brief|icon/i,
    );
  });
});

describe("narrateFight", () => {
  it("validates structured provider output and returns rendered lines", async () => {
    const turn = validTurn();
    const result = await narrateFight(sampleFightInput(), narrationCfg, {
      complete: async () => turn,
    });
    assert.equal(result.turn.winner_subname, "jason");
    assert.deepEqual(result.ensLines, renderEnsLines(turn));
    assert.equal(result.nextOpponentSubname, "leatherface");
    assert.equal(result.rationale, turn.rationale);
  });

  it("rejects a bad structured turn from the provider", async () => {
    await assert.rejects(
      () =>
        narrateFight(sampleFightInput(), narrationCfg, {
          complete: async () =>
            validTurn({ next_opponent_subname: "jason" }),
        }),
      /next opponent|winner/i,
    );
  });
});
