import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FightMediaConfig } from "../src/env.js";
import { fightMediaCdnUrl, frameObjectKey, videoObjectKey } from "../src/keys.js";
import {
  buildPutFightFrameInput,
  buildPutFightVideoInput,
  uploadFightFrame,
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
  it("places an object under videos/ with .mp4", () => {
    assert.equal(videoObjectKey("abc-123"), "videos/abc-123.mp4");
  });

  it("rejects blank or path-like ids", () => {
    assert.throws(() => videoObjectKey(""), /blank/u);
    assert.throws(() => videoObjectKey("a/b"), /single path segment/u);
  });
});

describe("frameObjectKey", () => {
  it("places an object under frames/ with .jpg", () => {
    assert.equal(frameObjectKey("abc-123"), "frames/abc-123.jpg");
  });

  it("rejects blank or path-like ids", () => {
    assert.throws(() => frameObjectKey(""), /blank/u);
    assert.throws(() => frameObjectKey("a/b"), /single path segment/u);
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

describe("buildPutFightFrameInput", () => {
  it("constructs a public-read jpeg PUT under frames/", () => {
    const body = new Uint8Array([0xff, 0xd8]);
    const input = buildPutFightFrameInput(config, body, "round-1");
    assert.deepEqual(input, {
      Bucket: "horror-tube-fight-media-test",
      Key: "frames/round-1.jpg",
      Body: body,
      ACL: "public-read",
      ContentType: "image/jpeg",
    });
  });
});

describe("uploadFightVideo", () => {
  it("propagates stub transport errors and does not return a URL", async () => {
    await assert.rejects(
      () =>
        uploadFightVideo({
          body: new Uint8Array([1]),
          config,
          putObject: async () => {
            throw new Error("AccessDenied: simulated Spaces failure");
          },
        }),
      /Spaces put_object failed.*videos\/[0-9a-f-]+\.mp4.*AccessDenied/u,
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

describe("uploadFightFrame", () => {
  it("uploads under frames/ and returns the CDN URL", async () => {
    let putKey = "";
    const url = await uploadFightFrame({
      body: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      config,
      putObject: async (input) => {
        putKey = input.Key;
        assert.equal(input.ContentType, "image/jpeg");
        assert.equal(input.ACL, "public-read");
      },
    });
    assert.match(putKey, /^frames\/[0-9a-f-]+\.jpg$/u);
    assert.equal(url, `https://${config.cdnHost}/${putKey}`);
  });

  it("propagates stub transport errors and does not return a URL", async () => {
    await assert.rejects(
      () =>
        uploadFightFrame({
          body: new Uint8Array([1]),
          config,
          putObject: async () => {
            throw new Error("AccessDenied: simulated Spaces failure");
          },
        }),
      /Spaces put_object failed.*frames\/[0-9a-f-]+\.jpg.*AccessDenied/u,
    );
  });

  it("rejects an empty body", async () => {
    await assert.rejects(
      () =>
        uploadFightFrame({
          body: new Uint8Array(),
          config,
          putObject: async () => {
            throw new Error("putObject must not be called for empty body");
          },
        }),
      /empty/u,
    );
  });
});

// Live Spaces PUT was not run: no FIGHT_MEDIA_SPACES_* credentials in this worktree .env.
// Request construction is covered by buildPutFightVideoInput / buildPutFightFrameInput;
// failure paths use a stub transport.
