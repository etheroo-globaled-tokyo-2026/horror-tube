import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FightTurnResult, LivingCard } from "@horror-tube/fight";

import {
  buildFightInput,
  createFightJobRunner,
  fightJobResultFromTurn,
  type FightJobRequest,
} from "../src/fight-job.js";

const card = (
  subname: string,
  overrides: Partial<LivingCard> = {},
): LivingCard => ({
  subname,
  look: `${subname} look`,
  brief: `${subname} brief`,
  injuries: [],
  status: "alive",
  ...overrides,
});

const baseRequest = (): FightJobRequest => ({
  battleId: "7",
  fighterASubname: "alpha",
  fighterBSubname: "bravo",
  livingSubnames: ["alpha", "bravo", "charlie"],
  priorFrameUrl: null,
  round: 1,
});

const falEnv = {
  FAL_KEY: "fal-test-key",
  FAL_MODEL: "minimax/h3-max/text-to-video",
  FAL_IMAGE_TO_VIDEO_MODEL: "minimax/h3-max/image-to-video",
  FIGHT_VIDEO_SECONDS: "8",
  FAL_VIDEO_RESOLUTION: "768P",
  FAL_PROMPT_EXPANSION_MODE: "balanced",
  FAL_ASPECT_RATIO: "16:9",
};

describe("buildFightInput", () => {
  it("maps fighter and eligible opponent cards from living subnames", () => {
    const input = buildFightInput(baseRequest(), [
      card("alpha"),
      card("bravo"),
      card("charlie"),
    ]);
    assert.equal(input.fighterA.subname, "alpha");
    assert.equal(input.fighterB.subname, "bravo");
    assert.deepEqual(
      input.eligibleOpponents.map((c) => c.subname),
      ["charlie"],
    );
  });

  it("names a missing fighter card", () => {
    assert.throws(
      () => buildFightInput(baseRequest(), [card("alpha"), card("charlie")]),
      /missing fighterB card for "bravo"/u,
    );
  });
});

describe("fightJobResultFromTurn", () => {
  it("maps winner side from narration subnames", () => {
    const result = fightJobResultFromTurn(
      baseRequest(),
      {
        shots: [
          {
            time_range: "0-4s",
            characters: "alpha and bravo",
            action: "clash",
            camera: "wide",
            style: "gritty",
          },
        ],
        ensLines: ["bravo|status=dead", 'alpha|injuries=["cut"]'] as [
          string,
          string,
        ],
        rationale: "alpha wins",
        winnerSubname: "alpha",
        loserSubname: "bravo",
        winnerInjuries: ["cut"],
        nextOpponentSubname: "charlie",
        videoUrl: "https://cdn.example/videos/a.mp4",
        videoStyle: "film",
        frameUrl: "https://cdn.example/frames/a.jpg",
      },
      8000,
      "fixed-id",
    );
    assert.equal(result.winnerSide, 0);
    assert.equal(result.damage, 1);
    assert.equal(result.durationMs, 8000);
    assert.equal(result.insert.id, "fixed-id");
    assert.equal(result.insert.battleId, "7");
    assert.equal(result.insert.winnerSubname, "alpha");
  });

  it("rejects a winner that is not a bout fighter", () => {
    assert.throws(
      () =>
        fightJobResultFromTurn(
          baseRequest(),
          {
            shots: [],
            ensLines: ["x|status=dead", "y|injuries=[]"] as [string, string],
            rationale: "bad",
            winnerSubname: "charlie",
            loserSubname: "bravo",
            winnerInjuries: [],
            nextOpponentSubname: "delta",
            videoUrl: "https://cdn.example/v.mp4",
            videoStyle: "film",
            frameUrl: "https://cdn.example/f.jpg",
          },
          1000,
        ),
      /winner "charlie" is neither fighterA/u,
    );
  });
});

describe("createFightJobRunner", () => {
  it("loads cards, passes priorFrameUrl, and maps runFightTurn without calling fal", async () => {
    const seen: {
      priorFrameUrl?: string;
      falModel?: string;
      subnames?: string[];
    } = {};
    const turnResult: FightTurnResult = {
      turn: {
        shots: [
          {
            time_range: "0-4s",
            characters: "looks",
            action: "fight",
            camera: "close",
            style: "noir",
          },
        ],
        loser_subname: "bravo",
        winner_subname: "alpha",
        winner_injuries: ["bruise"],
        rationale: "alpha by a cut",
        next_opponent_subname: "charlie",
      },
      ensLines: ["bravo|status=dead", 'alpha|injuries=["bruise"]'] as [
        string,
        string,
      ],
      nextOpponentSubname: "charlie",
      rationale: "alpha by a cut",
      videoPrompt: "prompt",
      videoUrl: "https://cdn.example/videos/job.mp4",
      videoStyle: "film",
      frameUrl: "https://cdn.example/frames/job.jpg",
      expandedPrompt: null,
    };
    const runner = createFightJobRunner({
      env: falEnv,
      loadLivingCards: async (subnames) => {
        seen.subnames = [...subnames].sort();
        return [card("alpha"), card("bravo"), card("charlie")];
      },
      runTurn: async (_input, _env, opts) => {
        seen.priorFrameUrl = opts?.priorFrameUrl;
        seen.falModel = opts?.falConfig?.model;
        return turnResult;
      },
    });
    const result = await runner({
      ...baseRequest(),
      priorFrameUrl: "https://cdn.example/frames/prior.jpg",
    });
    assert.deepEqual(seen.subnames, ["alpha", "bravo", "charlie"]);
    assert.equal(seen.priorFrameUrl, "https://cdn.example/frames/prior.jpg");
    assert.equal(seen.falModel, "minimax/h3-max/text-to-video");
    assert.equal(result.videoUrl, "https://cdn.example/videos/job.mp4");
    assert.equal(result.frameUrl, "https://cdn.example/frames/job.jpg");
    assert.equal(result.durationMs, 8000);
    assert.equal(result.winnerSide, 0);
    assert.equal(result.insert.winnerSubname, "alpha");
  });

  it("fails closed naming FAL_KEY when fal env is missing", async () => {
    const runner = createFightJobRunner({
      env: {},
      loadLivingCards: async () => [card("alpha"), card("bravo")],
      runTurn: async () => {
        throw new Error("runTurn must not run when fal env is missing.");
      },
    });
    await assert.rejects(
      () =>
        runner({
          battleId: "1",
          fighterASubname: "alpha",
          fighterBSubname: "bravo",
          livingSubnames: ["alpha", "bravo"],
          priorFrameUrl: null,
          round: 1,
        }),
      /FAL_KEY is required/u,
    );
  });

  it("omits priorFrameUrl for text-to-video when prior is null", async () => {
    let prior: string | undefined = "sentinel";
    const runner = createFightJobRunner({
      env: falEnv,
      loadLivingCards: async () => [card("alpha"), card("bravo")],
      runTurn: async (_input, _env, opts) => {
        prior = opts?.priorFrameUrl;
        return {
          turn: {
            shots: [],
            loser_subname: "bravo",
            winner_subname: "alpha",
            winner_injuries: [],
            rationale: "ok",
            next_opponent_subname: "alpha",
          },
          ensLines: ["bravo|status=dead", "alpha|injuries=[]"] as [
            string,
            string,
          ],
          nextOpponentSubname: "alpha",
          rationale: "ok",
          videoPrompt: "p",
          videoUrl: "https://cdn.example/v.mp4",
          videoStyle: "film",
          frameUrl: "https://cdn.example/f.jpg",
          expandedPrompt: null,
        };
      },
    });
    await runner({
      battleId: "1",
      fighterASubname: "alpha",
      fighterBSubname: "bravo",
      livingSubnames: ["alpha", "bravo"],
      priorFrameUrl: null,
      round: 1,
    });
    assert.equal(prior, undefined);
  });
});
