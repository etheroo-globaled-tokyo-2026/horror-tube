import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARENA_VIDEO_PROMPT_PREFIX, formatShotList, renderEnsLines, videoPromptFromTurn } from "../src/render.js";
import { validateFightInput, validateNarrationTurn } from "../src/validate.js";
import { sampleFightInput, validTurn } from "./fixtures.js";

describe("validateFightInput", () => {
  it("accepts two living fighters and living eligible opponents", () => {
    assert.doesNotThrow(() => validateFightInput(sampleFightInput()));
  });

  it("rejects a fighter who is not alive", () => {
    const input = sampleFightInput();
    (input.fighterA as { status: string }).status = "dead";
    assert.throws(() => validateFightInput(input), /status=alive|alive/);
  });
});

describe("validateNarrationTurn", () => {
  it("accepts a valid turn", () => {
    assert.doesNotThrow(() =>
      validateNarrationTurn(validTurn(), sampleFightInput()),
    );
  });

  it("rejects when both fighters are treated as dead", () => {
    assert.throws(
      () =>
        validateNarrationTurn(
          validTurn({
            loser_subname: "freddy",
            winner_subname: "freddy",
          }),
          sampleFightInput(),
        ),
      /both die|same|winner|loser/i,
    );
  });

  it("rejects when the loser is not one of the two fighters", () => {
    assert.throws(
      () =>
        validateNarrationTurn(
          validTurn({ loser_subname: "leatherface" }),
          sampleFightInput(),
        ),
      /loser/i,
    );
  });

  it("rejects when neither fighter is the loser (neither dies)", () => {
    assert.throws(
      () =>
        validateNarrationTurn(
          validTurn({
            loser_subname: "nobody",
            winner_subname: "jason",
          }),
          sampleFightInput(),
        ),
      /neither|loser|die/i,
    );
  });

  it("rejects when an injury phrase is missing from the shot list", () => {
    assert.throws(
      () =>
        validateNarrationTurn(
          validTurn({
            winner_injuries: ["cracked mask", "missing from shots"],
          }),
          sampleFightInput(),
        ),
      /injury|shot list/i,
    );
  });

  it("rejects when next opponent is the winner", () => {
    assert.throws(
      () =>
        validateNarrationTurn(
          validTurn({ next_opponent_subname: "jason" }),
          sampleFightInput(),
        ),
      /next opponent|winner/i,
    );
  });

  it("rejects when next opponent is missing from eligible living subnames", () => {
    assert.throws(
      () =>
        validateNarrationTurn(
          validTurn({ next_opponent_subname: "pinhead" }),
          sampleFightInput(),
        ),
      /next opponent|eligible|missing/i,
    );
  });

  it("rejects when next opponent is the dead loser", () => {
    assert.throws(
      () =>
        validateNarrationTurn(
          validTurn({ next_opponent_subname: "freddy" }),
          sampleFightInput(),
        ),
      /next opponent|dead|loser/i,
    );
  });
});

describe("renderEnsLines", () => {
  it("renders loser status=dead first and winner injuries JSON last", () => {
    const [loser, winner] = renderEnsLines(validTurn());
    assert.equal(loser, "freddy|status=dead");
    assert.equal(
      winner,
      'jason|injuries=["cracked mask","gouge across the shoulder"]',
    );
  });

  it("puts the winner line last", () => {
    const lines = renderEnsLines(validTurn());
    assert.equal(lines.length, 2);
    assert.match(lines[1]!, /\|injuries=/);
    assert.match(lines[0]!, /\|status=dead/);
  });
});

describe("videoPromptFromTurn", () => {
  it("starts with the arena prefix, then the shot list, and omits rationale and ENS lines", () => {
    const turn = validTurn();
    const prompt = videoPromptFromTurn(turn);
    assert.equal(prompt.startsWith(ARENA_VIDEO_PROMPT_PREFIX), true);
    assert.equal(
      prompt,
      `${ARENA_VIDEO_PROMPT_PREFIX}\n\n${formatShotList(turn.shots)}`,
    );
    assert.match(prompt, /0-4s/);
    assert.match(prompt, /machete/);
    assert.doesNotMatch(prompt, /Dream demon who kills/);
    assert.doesNotMatch(prompt, /status=dead/);
    assert.doesNotMatch(prompt, /\|injuries=/);
    assert.doesNotMatch(prompt, /overpower Freddy/);
    assert.equal(prompt.includes(turn.rationale), false);
  });

  it("keeps the arena prefix out of ENS lines", () => {
    const [loser, winner] = renderEnsLines(validTurn());
    assert.equal(loser.includes(ARENA_VIDEO_PROMPT_PREFIX), false);
    assert.equal(winner.includes(ARENA_VIDEO_PROMPT_PREFIX), false);
  });

  it("formats shots with look, timed beat, camera, and style", () => {
    const text = formatShotList(validTurn().shots);
    assert.match(text, /0-4s/);
    assert.match(text, /Camera:/i);
    assert.match(text, /Style:/i);
    assert.match(text, /Burned man in a striped sweater/);
  });
});
