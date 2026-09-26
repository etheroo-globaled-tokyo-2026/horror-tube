import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildFalInput, generateFightVideo } from "../src/fal-video.js";
import { validTurn } from "./fixtures.js";
import { ARENA_VIDEO_PROMPT_PREFIX, videoPromptFromTurn } from "../src/render.js";
import type { FalVideoConfig } from "../src/env.js";

const falCfg: FalVideoConfig = {
  apiKey: "fal-test",
  model: "minimax/h3-max/text-to-video",
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
    assert.equal(input.aspect_ratio, "16:9");
    assert.equal(JSON.stringify(input).includes("status=dead"), false);
    assert.equal(JSON.stringify(input).includes(turn.rationale), false);
    const [loser, winner] = [
      `${turn.loser_subname}|status=dead`,
      `${turn.winner_subname}|injuries=${JSON.stringify(turn.winner_injuries)}`,
    ];
    assert.equal(loser.includes(ARENA_VIDEO_PROMPT_PREFIX), false);
    assert.equal(winner.includes(ARENA_VIDEO_PROMPT_PREFIX), false);
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
