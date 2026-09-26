import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readFightMediaConfig,
  requiredEnv,
  spacesRegionFromEndpoint,
} from "../src/env.js";

const REQUIRED = [
  "FIGHT_MEDIA_SPACES_ACCESS_KEY_ID",
  "FIGHT_MEDIA_SPACES_SECRET",
  "FIGHT_MEDIA_SPACES_BUCKET",
  "FIGHT_MEDIA_SPACES_CDN_HOST",
  "FIGHT_MEDIA_SPACES_ENDPOINT",
] as const;

describe("requiredEnv", () => {
  for (const name of REQUIRED) {
    it(`rejects missing ${name}`, () => {
      assert.throws(() => requiredEnv(name, {}), new RegExp(name, "u"));
      assert.throws(
        () => requiredEnv(name, { [name]: "  " }),
        new RegExp(name, "u"),
      );
    });

    it(`error for ${name} points at .env.example`, () => {
      assert.throws(() => requiredEnv(name, {}), /\.env\.example/u);
    });
  }
});

describe("spacesRegionFromEndpoint", () => {
  it("reads the region prefix from the Spaces endpoint host", () => {
    assert.equal(spacesRegionFromEndpoint("https://sgp1.digitaloceanspaces.com"), "sgp1");
  });

  it("rejects a non-URL endpoint", () => {
    assert.throws(() => spacesRegionFromEndpoint("not-a-url"), /FIGHT_MEDIA_SPACES_ENDPOINT/u);
  });
});

describe("readFightMediaConfig", () => {
  it("reads every FIGHT_MEDIA_SPACES_* variable with no defaults", () => {
    const config = readFightMediaConfig({
      FIGHT_MEDIA_SPACES_ACCESS_KEY_ID: "AKIATEST",
      FIGHT_MEDIA_SPACES_SECRET: "secret-test",
      FIGHT_MEDIA_SPACES_BUCKET: "horror-tube-fight-media-test",
      FIGHT_MEDIA_SPACES_CDN_HOST: "cdn.example.test",
      FIGHT_MEDIA_SPACES_ENDPOINT: "https://sgp1.digitaloceanspaces.com",
    });
    assert.deepEqual(config, {
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret-test",
      bucket: "horror-tube-fight-media-test",
      cdnHost: "cdn.example.test",
      endpoint: "https://sgp1.digitaloceanspaces.com",
      region: "sgp1",
    });
  });

  it("fails when FIGHT_MEDIA_SPACES_BUCKET is blank", () => {
    assert.throws(
      () =>
        readFightMediaConfig({
          FIGHT_MEDIA_SPACES_ACCESS_KEY_ID: "AKIATEST",
          FIGHT_MEDIA_SPACES_SECRET: "secret-test",
          FIGHT_MEDIA_SPACES_BUCKET: "",
          FIGHT_MEDIA_SPACES_CDN_HOST: "cdn.example.test",
          FIGHT_MEDIA_SPACES_ENDPOINT: "https://sgp1.digitaloceanspaces.com",
        }),
      /FIGHT_MEDIA_SPACES_BUCKET/u,
    );
  });
});
