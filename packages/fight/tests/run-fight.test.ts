import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { PutFightVideoInput } from "@horror-tube/fight-media";

import { fightInputFromRotation, runFightTurn } from "../src/index.js";
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

const fightMediaConfig = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret-test",
  bucket: "horror-tube-fight-media-test",
  cdnHost: "horror-tube-fight-media-test.sgp1.cdn.digitaloceanspaces.com",
  endpoint: "https://sgp1.digitaloceanspaces.com",
  region: "sgp1",
};

describe("runFightTurn", () => {
  it("narrates, downloads fal bytes, uploads to Spaces, returns the CDN URL", async () => {
    const turn = validModelTurn();
    const saved = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      video: { url: string };
      expanded_prompt: string;
    };
    const mp4Bytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    let downloadedUrl: string | undefined;
    let putInput: PutFightVideoInput | undefined;

    const result = await runFightTurn(sampleFightInput(), {}, {
      narrationConfig: {
        provider: "anthropic",
        model: "claude-test",
        fightVideoSeconds: 8,
        apiKey: "sk-test",
      },
      falConfig: {
        apiKey: "fal-test",
        model: "minimax/h3-max/text-to-video",
        durationSeconds: 8,
        resolution: "768P",
        promptExpansionMode: "balanced",
        aspectRatio: "16:9",
      },
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
        putInput = input;
      },
      randomInt: () => 0,
    });

    assert.equal(downloadedUrl, saved.video.url);
    assert.ok(putInput !== undefined);
    assert.equal(putInput.Bucket, fightMediaConfig.bucket);
    assert.match(putInput.Key, /^videos\/[0-9a-f-]+\.mp4$/u);
    assert.equal(putInput.ACL, "public-read");
    assert.equal(putInput.ContentType, "video/mp4");
    assert.deepEqual(putInput.Body, mp4Bytes);
    assert.equal(
      result.videoUrl,
      `https://${fightMediaConfig.cdnHost}/${putInput.Key}`,
    );
    assert.notEqual(result.videoUrl, saved.video.url);
    assert.equal(result.expandedPrompt, saved.expanded_prompt);
    assert.equal(result.ensLines[0], "freddy|status=dead");
    assert.equal(result.nextOpponentSubname, "leatherface");
    assert.equal(result.rationale, turn.rationale);
    assert.equal(result.videoPrompt.includes(turn.rationale), false);
    assert.equal(result.videoPrompt.includes("status=dead"), false);
  });

  it("does not return the fal URL when Spaces upload fails", async () => {
    const turn = validModelTurn();
    const saved = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      video: { url: string };
      expanded_prompt: string;
    };

    await assert.rejects(
      () =>
        runFightTurn(sampleFightInput(), {}, {
          narrationConfig: {
            provider: "anthropic",
            model: "claude-test",
            fightVideoSeconds: 8,
            apiKey: "sk-test",
          },
          falConfig: {
            apiKey: "fal-test",
            model: "minimax/h3-max/text-to-video",
            durationSeconds: 8,
            resolution: "768P",
            promptExpansionMode: "balanced",
            aspectRatio: "16:9",
          },
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
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /Spaces put_object failed/u);
        assert.equal(err.message.includes(saved.video.url), false);
        return true;
      },
    );
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
