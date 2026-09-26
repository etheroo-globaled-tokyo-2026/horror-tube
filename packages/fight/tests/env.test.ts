import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  loadFalVideoConfig,
  loadNarrationConfig,
  requiredEnv,
} from "../src/env.js";

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

  it("loads fal config from env", () => {
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
    assert.equal(cfg.durationSeconds, 8);
    assert.equal(cfg.resolution, "768P");
    assert.equal(cfg.promptExpansionMode, "balanced");
    assert.equal(cfg.aspectRatio, "16:9");
  });
});
