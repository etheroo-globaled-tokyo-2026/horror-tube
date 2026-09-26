import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadFalVideoConfig,
  loadNarrationConfig,
  loadVideoEffectsConfig,
  requiredEnv,
} from "../src/env.js";

describe("loadVideoEffectsConfig", () => {
  it("needs nothing else when both switches are 0", () => {
    assert.deepEqual(loadVideoEffectsConfig({ DEMON_SOUND: "0", ROTOSCOPE: "0" }), {
      demonSound: false,
      rotoscope: null,
    });
  });

  it("accepts only 0 or 1", () => {
    assert.throws(
      () => loadVideoEffectsConfig({ DEMON_SOUND: "true", ROTOSCOPE: "0" }),
      /DEMON_SOUND must be "0" or "1"\. Got: "true"/,
    );
    assert.throws(
      () => loadVideoEffectsConfig({ DEMON_SOUND: "0" }),
      /ROTOSCOPE is required/,
    );
  });

  it("requires ROTOSCOPE_URL when ROTOSCOPE=1", () => {
    assert.throws(
      () =>
        loadVideoEffectsConfig({
          DEMON_SOUND: "0",
          ROTOSCOPE: "1",
          ROTOSCOPE_TIMEOUT_MS: "660000",
        }),
      /ROTOSCOPE_URL is required/,
    );
  });

  it("loads the rotoscope URL without its trailing slash, and the timeout", () => {
    assert.deepEqual(
      loadVideoEffectsConfig({
        DEMON_SOUND: "1",
        ROTOSCOPE: "1",
        ROTOSCOPE_URL: "http://127.0.0.1:8765/",
        ROTOSCOPE_TIMEOUT_MS: "660000",
      }),
      {
        demonSound: true,
        rotoscope: { url: "http://127.0.0.1:8765", timeoutMs: 660000 },
      },
    );
  });
});

describe("requiredEnv", () => {
  it("returns a trimmed value", () => {
    assert.equal(requiredEnv("X", { X: "  hi  " }), "hi");
  });

  it("fails naming the variable and pointing at .env.example when missing", () => {
    assert.throws(
      () => requiredEnv("NARRATION_PROVIDER", {}),
      /NARRATION_PROVIDER is required\. Set it in \.env\. See \.env\.example/,
    );
  });

  it("fails when blank", () => {
    assert.throws(
      () => requiredEnv("FAL_KEY", { FAL_KEY: "   " }),
      /FAL_KEY is required/,
    );
  });
});

describe("loadNarrationConfig", () => {
  it("requires anthropic key when provider is anthropic", () => {
    assert.throws(
      () =>
        loadNarrationConfig({
          NARRATION_PROVIDER: "anthropic",
          NARRATION_MODEL: "claude-sonnet-4-5",
          FIGHT_VIDEO_SECONDS: "8",
        }),
      /ANTHROPIC_API_KEY is required/,
    );
  });

  it("requires gemini key when provider is gemini", () => {
    assert.throws(
      () =>
        loadNarrationConfig({
          NARRATION_PROVIDER: "gemini",
          NARRATION_MODEL: "gemini-2.5-pro",
          FIGHT_VIDEO_SECONDS: "8",
          GEMINI_API_KEY: "",
        }),
      /GEMINI_API_KEY is required/,
    );
  });

  it("rejects an unknown provider without retrying another", () => {
    assert.throws(
      () =>
        loadNarrationConfig({
          NARRATION_PROVIDER: "openai",
          NARRATION_MODEL: "x",
          FIGHT_VIDEO_SECONDS: "8",
        }),
      /NARRATION_PROVIDER/,
    );
  });

  it("loads anthropic config when the key is present", () => {
    const cfg = loadNarrationConfig({
      NARRATION_PROVIDER: "anthropic",
      NARRATION_MODEL: "claude-sonnet-4-5",
      FIGHT_VIDEO_SECONDS: "8",
      ANTHROPIC_API_KEY: "sk-test",
    });
    assert.equal(cfg.provider, "anthropic");
    assert.equal(cfg.model, "claude-sonnet-4-5");
    assert.equal(cfg.fightVideoSeconds, 8);
    assert.equal(cfg.apiKey, "sk-test");
  });
});

describe("loadFalVideoConfig", () => {
  it("requires FAL_KEY, FAL_MODEL, duration, resolution, expansion mode, aspect ratio", () => {
    assert.throws(
      () => loadFalVideoConfig({ FAL_KEY: "k" }),
      /FAL_MODEL is required/,
    );
    assert.throws(
      () =>
        loadFalVideoConfig({
          FAL_KEY: "k",
          FAL_MODEL: "minimax/h3-max/text-to-video",
          FIGHT_VIDEO_SECONDS: "8",
          FAL_VIDEO_RESOLUTION: "768P",
          FAL_PROMPT_EXPANSION_MODE: "balanced",
        }),
      /FAL_ASPECT_RATIO is required/,
    );
  });

  it("loads fal config from env and leaves image-to-video model null when blank", () => {
    const cfg = loadFalVideoConfig({
      FAL_KEY: "fal-test",
      FAL_MODEL: "minimax/h3-max/text-to-video",
      FIGHT_VIDEO_SECONDS: "8",
      FAL_VIDEO_RESOLUTION: "768P",
      FAL_PROMPT_EXPANSION_MODE: "balanced",
      FAL_ASPECT_RATIO: "16:9",
    });
    assert.equal(cfg.apiKey, "fal-test");
    assert.equal(cfg.model, "minimax/h3-max/text-to-video");
    assert.equal(cfg.imageToVideoModel, null);
    assert.equal(cfg.durationSeconds, 8);
    assert.equal(cfg.resolution, "768P");
    assert.equal(cfg.promptExpansionMode, "balanced");
    assert.equal(cfg.aspectRatio, "16:9");
  });

  it("loads FAL_IMAGE_TO_VIDEO_MODEL when set", () => {
    const cfg = loadFalVideoConfig({
      FAL_KEY: "fal-test",
      FAL_MODEL: "minimax/h3-max/text-to-video",
      FAL_IMAGE_TO_VIDEO_MODEL: "minimax/h3-max/image-to-video",
      FIGHT_VIDEO_SECONDS: "8",
      FAL_VIDEO_RESOLUTION: "768P",
      FAL_PROMPT_EXPANSION_MODE: "balanced",
      FAL_ASPECT_RATIO: "16:9",
    });
    assert.equal(cfg.imageToVideoModel, "minimax/h3-max/image-to-video");
  });
});
