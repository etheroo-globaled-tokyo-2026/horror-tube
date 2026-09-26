import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertTurnContractText, narrateFight } from "../src/narrate.js";
import { renderEnsLines } from "../src/render.js";
import { sampleFightInput, validModelTurn, validTurn } from "./fixtures.js";
import type { NarrationConfig } from "../src/env.js";

const narrationCfg: NarrationConfig = {
  provider: "anthropic",
  model: "claude-test",
  fightVideoSeconds: 8,
  apiKey: "sk-test",
};

const pickFirst = () => 0;
const pickLast = (maxExclusive: number) => maxExclusive - 1;

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
  it("validates structured provider output and sets next opponent from rotation", async () => {
    const modelTurn = validModelTurn();
    let systemPrompt = "";
    const result = await narrateFight(
      sampleFightInput(),
      narrationCfg,
      {
        complete: async ({ system }) => {
          systemPrompt = system;
          return modelTurn;
        },
      },
      pickFirst,
    );
    assert.equal(result.turn.winner_subname, "jason");
    assert.deepEqual(result.ensLines, renderEnsLines(result.turn));
    assert.equal(result.nextOpponentSubname, "leatherface");
    assert.equal(result.turn.next_opponent_subname, "leatherface");
    assert.equal(result.rationale, modelTurn.rationale);
    assert.match(
      systemPrompt,
      /Use a terrifying battle royale arena for the battle, each fighter starting on opposite sides\./,
    );
    assert.match(systemPrompt, /Do not invent a different location/);
    assert.match(systemPrompt, /opposite sides/);
    assert.match(systemPrompt, /Do not name a next opponent/);
  });

  it("ignores any model-supplied next opponent and uses the injected random pick", async () => {
    const result = await narrateFight(
      sampleFightInput(),
      narrationCfg,
      {
        complete: async () => validModelTurn(),
      },
      pickLast,
    );
    assert.equal(result.nextOpponentSubname, "chucky");
    assert.equal(result.turn.next_opponent_subname, "chucky");
  });

  it("rejects a bad structured turn from the provider", async () => {
    await assert.rejects(
      () =>
        narrateFight(
          sampleFightInput(),
          narrationCfg,
          {
            complete: async () =>
              validModelTurn({
                loser_subname: "freddy",
                winner_subname: "freddy",
              }),
          },
          pickFirst,
        ),
      /both die|same/i,
    );
  });
});
