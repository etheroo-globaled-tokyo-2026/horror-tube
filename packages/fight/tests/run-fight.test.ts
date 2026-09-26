import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { PutFightVideoInput } from "@horror-tube/fight-media";

import {
  buildShotList,
  fightInputFromRotation,
  RotoscopeError,
  runFightTurn,
  type FightTurnDeps,
  type RotoscopeConfig,
  type RotoscopeShotList,
} from "../src/index.js";
import {
  fighterA,
  fighterB,
  livingOpponent,
  otherLiving,
  sampleFightInput,
  validModelTurn,
} from "./fixtures.js";

const saved = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "fal-h3-max-response.json"),
    "utf8",
  ),
) as { video: { url: string }; expanded_prompt: string };

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

const rotoscopeConfig: RotoscopeConfig = {
  url: "http://127.0.0.1:8765",
  timeoutMs: 660_000,
};

const FILM = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const DEMON = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0xde]);
const DRAWN = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0xd7]);
const FRAME = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

/** Fakes for every outside call, effects off. Records downloads, frame extracts and uploads. */
function fakeRun(overrides: FightTurnDeps = {}) {
  const downloads: string[] = [];
  const extracted: Uint8Array[] = [];
  const puts: PutFightVideoInput[] = [];
  const deps: FightTurnDeps = {
    narrationConfig,
    falConfig,
    videoEffects: { demonSound: false, rotoscope: null },
    narration: { complete: async () => validModelTurn() },
    fal: { subscribe: async () => ({ data: saved, requestId: "fixture-req" }) },
    fetch: async (url) => {
      downloads.push(url);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => FILM.slice().buffer,
      };
    },
    fightMediaConfig,
    putObject: async (input) => {
      puts.push(input);
    },
    extractLastFrame: async (mp4) => {
      extracted.push(mp4);
      return FRAME;
    },
    randomInt: () => 0,
    log: () => {},
    ...overrides,
  };
  return {
    run: () => runFightTurn(sampleFightInput(), {}, deps),
    downloads,
    extracted,
    puts,
    uploaded: (contentType: string) =>
      puts.find((p) => p.ContentType === contentType),
  };
}

describe("runFightTurn", () => {
  it("with both effects off, uploads fal's video and its last frame and returns CDN URLs", async () => {
    const fake = fakeRun();
    const result = await fake.run();

    assert.deepEqual(fake.downloads, [saved.video.url]);
    assert.equal(fake.puts.length, 2);
    const videoPut = fake.uploaded("video/mp4");
    const framePut = fake.uploaded("image/jpeg");
    assert.ok(videoPut !== undefined);
    assert.ok(framePut !== undefined);
    assert.equal(videoPut.Bucket, fightMediaConfig.bucket);
    assert.match(videoPut.Key, /^videos\/[0-9a-f-]+\.mp4$/u);
    assert.match(framePut.Key, /^frames\/[0-9a-f-]+\.jpg$/u);
    assert.deepEqual(videoPut.Body, FILM);
    assert.deepEqual(framePut.Body, FRAME);
    assert.equal(result.videoStyle, "film");
    assert.equal(result.videoUrl, `https://${fightMediaConfig.cdnHost}/${videoPut.Key}`);
    assert.equal(result.frameUrl, `https://${fightMediaConfig.cdnHost}/${framePut.Key}`);
    assert.notEqual(result.videoUrl, saved.video.url);
    assert.equal(result.expandedPrompt, saved.expanded_prompt);
    assert.equal(result.ensLines[0], "freddy|status=dead");
    assert.equal(result.nextOpponentSubname, "leatherface");
    assert.equal(result.rationale, validModelTurn().rationale);
    assert.equal(result.videoPrompt.includes(result.rationale), false);
    assert.equal(result.videoPrompt.includes("status=dead"), false);
  });

  it("with DEMON_SOUND=1, uploads the demon-sound video and seeds the next bout from fal's footage", async () => {
    const demonInputs: Uint8Array[] = [];
    const fake = fakeRun({
      videoEffects: { demonSound: true, rotoscope: null },
      applyDemonSound: async (mp4) => {
        demonInputs.push(mp4);
        return DEMON;
      },
    });
    const result = await fake.run();

    assert.deepEqual(demonInputs, [FILM]);
    assert.deepEqual(fake.extracted, [FILM]);
    assert.deepEqual(fake.uploaded("video/mp4")?.Body, DEMON);
    assert.equal(result.videoStyle, "film");
  });

  it("with ROTOSCOPE=1, sends fal's video and the narrated shot list to the service and uploads the drawing", async () => {
    const calls: { mp4: Uint8Array; shotList: RotoscopeShotList; config: RotoscopeConfig }[] = [];
    const fake = fakeRun({
      videoEffects: { demonSound: false, rotoscope: rotoscopeConfig },
      rotoscopeVideo: async (mp4, shotList, config) => {
        calls.push({ mp4, shotList, config });
        return { video: DRAWN, frames: 75, seconds: 40 };
      },
    });
    const result = await fake.run();

    assert.deepEqual(calls, [
      {
        mp4: FILM,
        shotList: buildShotList(validModelTurn().shots, sampleFightInput()),
        config: rotoscopeConfig,
      },
    ]);
    assert.deepEqual(fake.extracted, [FILM]);
    assert.deepEqual(fake.uploaded("video/mp4")?.Body, DRAWN);
    assert.equal(result.videoStyle, "rotoscope");
  });

  it("fails the turn and uploads nothing when the rotoscope service fails", async () => {
    const fake = fakeRun({
      videoEffects: { demonSound: false, rotoscope: rotoscopeConfig },
      rotoscopeVideo: async () => {
        throw new RotoscopeError(
          "rotoscope service answered HTTP 500 for http://127.0.0.1:8765/v1/rotoscope: segmenter failed {}",
          { status: 500, serviceError: { error: "segmenter failed", detail: {} } },
        );
      },
    });

    await assert.rejects(fake.run, (err: unknown) => {
      assert.ok(err instanceof RotoscopeError);
      assert.match(err.message, /segmenter failed/);
      return true;
    });
    assert.equal(fake.puts.length, 0);
  });

  it("with ROTOSCOPE=1, fails before fal runs when a shot's time range can't be read", async () => {
    let falCalls = 0;
    const shots = validModelTurn().shots.map((shot, i) =>
      i === 0 ? { ...shot, time_range: "the opening" } : shot,
    );
    const fake = fakeRun({
      videoEffects: { demonSound: false, rotoscope: rotoscopeConfig },
      narration: { complete: async () => validModelTurn({ shots }) },
      fal: {
        subscribe: async () => {
          falCalls += 1;
          return { data: saved, requestId: "fixture-req" };
        },
      },
    });

    await assert.rejects(fake.run, /time_range "the opening" is not seconds/);
    assert.equal(falCalls, 0);
  });

  it("seeds the next fal request with image_url and the image-to-video model", async () => {
    const priorFrameUrl =
      "https://horror-tube-fight-media-test.sgp1.cdn.digitaloceanspaces.com/frames/prior.jpg";
    let subscribedModel = "";
    let subscribedInput: Record<string, unknown> | undefined;
    const fake = fakeRun({
      priorFrameUrl,
      fal: {
        subscribe: async (model, opts) => {
          subscribedModel = model;
          subscribedInput = opts.input;
          return { data: saved, requestId: "i2v-req" };
        },
      },
    });
    await fake.run();

    assert.equal(subscribedModel, "minimax/h3-max/image-to-video");
    assert.equal(subscribedInput?.image_url, priorFrameUrl);
    assert.equal(subscribedInput?.aspect_ratio, undefined);
  });

  it("does not return the fal URL when Spaces upload fails", async () => {
    const fake = fakeRun({
      putObject: async () => {
        throw new Error("AccessDenied: simulated Spaces failure");
      },
    });

    await assert.rejects(fake.run, (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Spaces put_object failed/u);
      assert.equal(err.message.includes(saved.video.url), false);
      return true;
    });
  });

  it("fails closed and uploads nothing when last-frame extract fails", async () => {
    const fake = fakeRun({
      extractLastFrame: async () => {
        throw new Error("ffmpeg exited 1 while extracting");
      },
    });

    await assert.rejects(fake.run, /ffmpeg exited 1/);
    assert.equal(fake.puts.length, 0);
  });
});

describe("fightInputFromRotation", () => {
  it("builds a bout pair from the winner and an injected random living challenger", () => {
    const living = [fighterA, fighterB, livingOpponent, otherLiving];
    const input = fightInputFromRotation(living, "jason", () => 0);
    assert.equal(input.fighterA.subname, "jason");
    // Living non-winners in order: freddy, leatherface, chucky
    assert.equal(input.fighterB.subname, "freddy");
    assert.deepEqual(
      input.eligibleOpponents.map((c) => c.subname),
      ["leatherface", "chucky"],
    );
  });
});
