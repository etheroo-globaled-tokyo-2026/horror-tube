import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { PutFightVideoInput } from "@horror-tube/fight-media";
import { z } from "zod";

import {
  fightInputFromRotation,
  runFightTurn,
  type FalVideoInput,
} from "../src/index.js";
import {
  fighterA,
  fighterB,
  livingOpponent,
  otherLiving,
  sampleFightInput,
  validModelTurn,
} from "./fixtures.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "fal-h3-max-response.json",
);

const savedFalResponseSchema = z.object({
  video: z.object({ url: z.string() }),
  expanded_prompt: z.string(),
});

function readSavedFalResponse() {
  return savedFalResponseSchema.parse(
    JSON.parse(readFileSync(fixturePath, "utf8")),
  );
}

const fightMediaConfig = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret-test",
  bucket: "horror-tube-fight-media-test",
  cdnHost: "horror-tube-fight-media-test.sgp1.cdn.digitaloceanspaces.com",
  endpoint: "https://sgp1.digitaloceanspaces.com",
  region: "sgp1",
};

const falConfig = {
  apiKey: "fal-test",
  model: "minimax/h3-max/text-to-video",
  imageToVideoModel: "minimax/h3-max/image-to-video",
  durationSeconds: 8,
  resolution: "768P",
  promptExpansionMode: "balanced",
  aspectRatio: "16:9",
};

const narrationConfig = {
  provider: "anthropic" as const,
  model: "claude-test",
  fightVideoSeconds: 8,
  apiKey: "sk-test",
};

describe("runFightTurn", () => {
  it("narrates, downloads fal bytes, uploads video and frame, returns CDN URLs", async () => {
    const turn = validModelTurn();
    const saved = readSavedFalResponse();
    const mp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    const frameBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    let downloadedUrl: string | undefined;
    const puts: PutFightVideoInput[] = [];

    const result = await runFightTurn(sampleFightInput(), {}, {
      narrationConfig,
      falConfig,
      narration: { complete: async () => turn },
      fal: {
        subscribe: async () => ({
          data: saved,
          requestId: "fixture-req",
        }),
      },
      fetch: async (url) => {
        downloadedUrl = url;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () =>
            mp4Bytes.buffer.slice(
              mp4Bytes.byteOffset,
              mp4Bytes.byteOffset + mp4Bytes.byteLength,
            ),
        };
      },
      fightMediaConfig,
      putObject: async (input) => {
        puts.push(input);
      },
      extractLastFrame: async () => frameBytes,
      randomInt: () => 0,
    });

    assert.equal(downloadedUrl, saved.video.url);
    assert.equal(puts.length, 2);
    const videoPut = puts.find((p) => p.ContentType === "video/mp4");
    const framePut = puts.find((p) => p.ContentType === "image/jpeg");
    assert.ok(videoPut !== undefined);
    assert.ok(framePut !== undefined);
    assert.equal(videoPut.Bucket, fightMediaConfig.bucket);
    assert.match(videoPut.Key, /^videos\/[0-9a-f-]+\.mp4$/u);
    assert.match(framePut.Key, /^frames\/[0-9a-f-]+\.jpg$/u);
    assert.deepEqual(videoPut.Body, mp4Bytes);
    assert.deepEqual(framePut.Body, frameBytes);
    assert.equal(
      result.videoUrl,
      `https://${fightMediaConfig.cdnHost}/${videoPut.Key}`,
    );
    assert.equal(
      result.frameUrl,
      `https://${fightMediaConfig.cdnHost}/${framePut.Key}`,
    );
    assert.notEqual(result.videoUrl, saved.video.url);
    assert.equal(result.expandedPrompt, saved.expanded_prompt);
    assert.equal(result.ensLines[0], "freddy|status=dead");
    assert.equal(result.nextOpponentSubname, "leatherface");
    assert.equal(result.rationale, turn.rationale);
    assert.equal(result.videoPrompt.includes(turn.rationale), false);
    assert.equal(result.videoPrompt.includes("status=dead"), false);
  });

  it("seeds the next fal request with image_url and the image-to-video model", async () => {
    const turn = validModelTurn();
    const priorFrameUrl =
      "https://horror-tube-fight-media-test.sgp1.cdn.digitaloceanspaces.com/frames/prior.jpg";
    let subscribedModel = "";
    let subscribedInput: FalVideoInput | undefined;

    await runFightTurn(sampleFightInput(), {}, {
      narrationConfig,
      falConfig,
      priorFrameUrl,
      narration: { complete: async () => turn },
      fal: {
        subscribe: async (model, opts) => {
          subscribedModel = model;
          subscribedInput = opts.input;
          return {
            data: {
              video: { url: "https://v3b.fal.media/files/b/example/fight.mp4" },
              expanded_prompt: "x",
            },
            requestId: "i2v-req",
          };
        },
      },
      fetch: async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
      fightMediaConfig,
      putObject: async () => {},
      extractLastFrame: async () => new Uint8Array([0xff, 0xd8]),
      randomInt: () => 0,
    });

    assert.equal(subscribedModel, "minimax/h3-max/image-to-video");
    assert.ok(subscribedInput !== undefined && "image_url" in subscribedInput);
    assert.equal(subscribedInput.image_url, priorFrameUrl);
    assert.equal("aspect_ratio" in subscribedInput, false);
  });

  it("does not return the fal URL when Spaces upload fails", async () => {
    const turn = validModelTurn();
    const saved = readSavedFalResponse();

    await assert.rejects(
      () =>
        runFightTurn(sampleFightInput(), {}, {
          narrationConfig,
          falConfig,
          narration: { complete: async () => turn },
          fal: {
            subscribe: async () => ({
              data: saved,
              requestId: "fixture-req",
            }),
          },
          fetch: async () => ({
            ok: true,
            status: 200,
            statusText: "OK",
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          }),
          fightMediaConfig,
          putObject: async () => {
            throw new Error("AccessDenied: simulated Spaces failure");
          },
          randomInt: () => 0,
        }),
      (cause: unknown) => {
        assert.ok(cause instanceof Error);
        assert.match(cause.message, /Spaces put_object failed/u);
        assert.equal(cause.message.includes(saved.video.url), false);
        return true;
      },
    );
  });

  it("fails closed when last-frame extract fails after the video uploaded", async () => {
    const turn = validModelTurn();
    await assert.rejects(
      () =>
        runFightTurn(sampleFightInput(), {}, {
          narrationConfig,
          falConfig,
          narration: { complete: async () => turn },
          fal: {
            subscribe: async () => ({
              data: {
                video: { url: "https://v3b.fal.media/files/b/example/fight.mp4" },
              },
              requestId: "fixture-req",
            }),
          },
          fetch: async () => ({
            ok: true,
            status: 200,
            statusText: "OK",
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          }),
          fightMediaConfig,
          putObject: async () => {},
          extractLastFrame: async () => {
            throw new Error("ffmpeg exited 1 while extracting");
          },
          randomInt: () => 0,
        }),
      /ffmpeg exited 1/,
    );
  });
});

describe("fightInputFromRotation", () => {
  it("builds a bout pair from the winner and an injected random living challenger", () => {
    const living = [fighterA, fighterB, livingOpponent, otherLiving];
    const input = fightInputFromRotation(living, "jason", () => 0);
    assert.equal(input.fighterA.subname, "jason");
    assert.equal(input.fighterB.subname, "freddy");
    assert.deepEqual(
      input.eligibleOpponents.map((c) => c.subname),
      ["leatherface", "chucky"],
    );
  });
});
