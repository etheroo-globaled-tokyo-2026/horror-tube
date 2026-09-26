import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFalInput,
  generateFightVideo,
} from "../src/fal-video.js";
import {
  resolveFalSubscribeModel,
  type FalVideoConfig,
} from "../src/env.js";
import { validTurn } from "./fixtures.js";
import { ARENA_VIDEO_PROMPT_PREFIX, videoPromptFromTurn } from "../src/render.js";

const falCfg: FalVideoConfig = {
  apiKey: "fal-test",
  model: "minimax/h3-max/text-to-video",
  imageToVideoModel: "minimax/h3-max/image-to-video",
  durationSeconds: 8,
  resolution: "768P",
  promptExpansionMode: "balanced",
  aspectRatio: "16:9",
};

describe("buildFalInput", () => {
  it("sends prompt plus required fal fields and never ENS lines or rationale", () => {
    const turn = validTurn();
    const input = buildFalInput(turn, falCfg);
    assert.equal(input.prompt, videoPromptFromTurn(turn));
    assert.equal(input.prompt.startsWith(ARENA_VIDEO_PROMPT_PREFIX), true);
    assert.equal(input.duration, 8);
    assert.equal(input.resolution, "768P");
    assert.equal(input.prompt_expansion_mode, "balanced");
    assert.equal("aspect_ratio" in input && input.aspect_ratio, "16:9");
    assert.equal("image_url" in input, false);
    assert.equal(JSON.stringify(input).includes("status=dead"), false);
    assert.equal(JSON.stringify(input).includes(turn.rationale), false);
    const [loser, winner] = [
      `${turn.loser_subname}|status=dead`,
      `${turn.winner_subname}|injuries=${JSON.stringify(turn.winner_injuries)}`,
    ];
    assert.equal(loser.includes(ARENA_VIDEO_PROMPT_PREFIX), false);
    assert.equal(winner.includes(ARENA_VIDEO_PROMPT_PREFIX), false);
  });

  it("attaches image_url for the next fight and omits aspect_ratio", () => {
    const turn = validTurn();
    const frameUrl =
      "https://cdn.example/frames/previous.jpg";
    const input = buildFalInput(turn, falCfg, { priorFrameUrl: frameUrl });
    assert.equal("image_url" in input && input.image_url, frameUrl);
    assert.equal("aspect_ratio" in input, false);
    assert.match(input.prompt, /gone from the arena/u);
    assert.equal(
      resolveFalSubscribeModel(falCfg, frameUrl),
      "minimax/h3-max/image-to-video",
    );
  });

  it("fails closed when a prior frame is set but FAL_IMAGE_TO_VIDEO_MODEL is blank", () => {
    const cfg: FalVideoConfig = { ...falCfg, imageToVideoModel: null };
    assert.throws(
      () =>
        resolveFalSubscribeModel(
          cfg,
          "https://cdn.example/frames/previous.jpg",
        ),
      /FAL_IMAGE_TO_VIDEO_MODEL is required/,
    );
  });
});

describe("generateFightVideo", () => {
  it("returns video.url from a saved fal response shape", async () => {
    const turn = validTurn();
    const result = await generateFightVideo(turn, falCfg, {
      subscribe: async () => ({
        data: {
          video: {
            url: "https://v3b.fal.media/files/b/example/fight.mp4",
            content_type: "video/mp4",
            file_name: "fight.mp4",
            file_size: 1234,
          },
          expanded_prompt: "expanded shot list",
        },
        requestId: "req-1",
      }),
    });
    assert.equal(result.videoUrl, "https://v3b.fal.media/files/b/example/fight.mp4");
    assert.equal(result.expandedPrompt, "expanded shot list");
    assert.equal(result.prompt, videoPromptFromTurn(turn));
    assert.equal(result.model, "minimax/h3-max/text-to-video");
  });

  it("subscribes to the image-to-video model with image_url when seeded", async () => {
    const turn = validTurn();
    const frameUrl = "https://cdn.example/frames/seed.jpg";
    let subscribedModel = "";
    let subscribedInput: Record<string, unknown> | undefined;
    const result = await generateFightVideo(
      turn,
      falCfg,
      {
        subscribe: async (model, opts) => {
          subscribedModel = model;
          subscribedInput = opts.input;
          return {
            data: {
              video: { url: "https://v3b.fal.media/files/b/example/fight2.mp4" },
            },
            requestId: "req-i2v",
          };
        },
      },
      { priorFrameUrl: frameUrl },
    );
    assert.equal(subscribedModel, "minimax/h3-max/image-to-video");
    assert.equal(subscribedInput?.image_url, frameUrl);
    assert.equal(subscribedInput?.aspect_ratio, undefined);
    assert.equal(result.model, "minimax/h3-max/image-to-video");
  });

  it("stops and surfaces the underlying fal failure", async () => {
    await assert.rejects(
      () =>
        generateFightVideo(validTurn(), falCfg, {
          subscribe: async () => {
            throw new Error("fal queue exploded: 401");
          },
        }),
      /fal queue exploded: 401/,
    );
  });

  it("surfaces fal ApiError status and body when message is empty", async () => {
    await assert.rejects(
      () =>
        generateFightVideo(validTurn(), falCfg, {
          subscribe: async () => {
            const err = new Error("") as Error & {
              status: number;
              body: { detail: string };
            };
            err.status = 401;
            err.body = { detail: "invalid key credentials" };
            throw err;
          },
        }),
      /status=401.*invalid key credentials/,
    );
  });

  it("fails when the fal response has no video.url", async () => {
    await assert.rejects(
      () =>
        generateFightVideo(validTurn(), falCfg, {
          subscribe: async () => ({
            data: { video: { url: "" } },
            requestId: "req-2",
          }),
        }),
      /video\.url/,
    );
  });
});
