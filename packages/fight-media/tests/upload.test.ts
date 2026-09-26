import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FightMediaConfig } from "../src/env.js";
import { fightMediaCdnUrl, videoObjectKey } from "../src/keys.js";
import {
  buildPutFightVideoInput,
  type PutFightVideoInput,
  uploadFightVideo,
} from "../src/upload.js";

const config: FightMediaConfig = {
  accessKeyId: "AKIATEST",
  secretAccessKey: "secret-test",
  bucket: "horror-tube-fight-media-test",
  cdnHost: "horror-tube-fight-media-test.sgp1.cdn.digitaloceanspaces.com",
  endpoint: "https://sgp1.digitaloceanspaces.com",
  region: "sgp1",
};

describe("videoObjectKey", () => {
  it("places a new object under videos/ with .mp4", () => {
    assert.equal(videoObjectKey("abc-123"), "videos/abc-123.mp4");
  });

  it("rejects blank or path-like ids", () => {
    assert.throws(() => videoObjectKey(""), /blank/u);
    assert.throws(() => videoObjectKey("a/b"), /single path segment/u);
  });
});

describe("fightMediaCdnUrl", () => {
  it("builds https://cdn-host/key", () => {
    assert.equal(
      fightMediaCdnUrl(config.cdnHost, "videos/abc-123.mp4"),
      "https://horror-tube-fight-media-test.sgp1.cdn.digitaloceanspaces.com/videos/abc-123.mp4",
    );
  });

  it("strips a leading https:// on the host", () => {
    assert.equal(
      fightMediaCdnUrl(`https://${config.cdnHost}`, "videos/x.mp4"),
      `https://${config.cdnHost}/videos/x.mp4`,
    );
  });

  it("rejects http:// CDN hosts", () => {
    assert.throws(() => fightMediaCdnUrl("http://cdn.example.test", "videos/x.mp4"), /https/u);
  });
});

describe("buildPutFightVideoInput", () => {
  it("constructs a public-read mp4 PUT under videos/", () => {
    const body = new Uint8Array([0, 1, 2, 3]);
    const input = buildPutFightVideoInput(config, body, "round-1");
    assert.deepEqual(input, {
      Bucket: "horror-tube-fight-media-test",
      Key: "videos/round-1.mp4",
      Body: body,
      ACL: "public-read",
      ContentType: "video/mp4",
    });
  });
});

describe("uploadFightVideo", () => {
  it("returns the CDN URL after a successful PUT (stub transport)", async () => {
    const body = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    let seen: PutFightVideoInput | undefined;
    const url = await uploadFightVideo({
      body,
      config,
      objectId: "fight-9",
      putObject: async (input) => {
        seen = input;
      },
    });
    assert.equal(
      url,
      "https://horror-tube-fight-media-test.sgp1.cdn.digitaloceanspaces.com/videos/fight-9.mp4",
    );
    assert.equal(seen?.Bucket, config.bucket);
    assert.equal(seen?.Key, "videos/fight-9.mp4");
    assert.equal(seen?.ACL, "public-read");
    assert.equal(seen?.ContentType, "video/mp4");
    assert.equal(seen?.Body, body);
  });

  it("propagates stub transport errors and does not return a URL", async () => {
    await assert.rejects(
      () =>
        uploadFightVideo({
          body: new Uint8Array([1]),
          config,
          objectId: "fail-1",
          putObject: async () => {
            throw new Error("AccessDenied: simulated Spaces failure");
          },
        }),
      /Spaces put_object failed.*videos\/fail-1\.mp4.*AccessDenied/u,
    );
  });

  it("rejects an empty body", async () => {
    await assert.rejects(
      () =>
        uploadFightVideo({
          body: new Uint8Array(),
          config,
          putObject: async () => {
            throw new Error("putObject must not be called for empty body");
          },
        }),
      /empty/u,
    );
  });

  it("fails on missing env before attempting PUT", async () => {
    await assert.rejects(
      () =>
        uploadFightVideo({
          body: new Uint8Array([1]),
          env: {},
          putObject: async () => {
            throw new Error("putObject must not be called when env is missing");
          },
        }),
      /FIGHT_MEDIA_SPACES_ACCESS_KEY_ID/u,
    );
  });
});

// Live Spaces PUT was not run: no fight-media credentials in this environment.
// Request construction and failure paths are covered with a stub transport above.
