import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertProductionNarration,
  livingCardFromJson,
  loadDemoConfigs,
  main,
  PRODUCTION_NARRATION_MODEL,
} from "../src/demo.js";

describe("assertProductionNarration", () => {
  it("accepts the production Anthropic model", () => {
    assert.doesNotThrow(() =>
      assertProductionNarration({
        provider: "anthropic",
        model: PRODUCTION_NARRATION_MODEL,
        fightVideoSeconds: 10,
        apiKey: "sk-test",
      }),
    );
  });

  it("rejects a different model and names both ids", () => {
    assert.throws(
      () =>
        assertProductionNarration({
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          fightVideoSeconds: 10,
          apiKey: "sk-test",
        }),
      /NARRATION_MODEL=claude-sonnet-5.*claude-sonnet-4-5/s,
    );
  });

  it("rejects a non-anthropic provider", () => {
    assert.throws(
      () =>
        assertProductionNarration({
          provider: "gemini",
          model: PRODUCTION_NARRATION_MODEL,
          fightVideoSeconds: 10,
          apiKey: "k",
        }),
      /NARRATION_PROVIDER=anthropic/,
    );
  });
});

describe("livingCardFromJson", () => {
  const card = {
    subname: "freddy",
    look: "burned face",
    brief: "dream killer",
    injuries: ["scarred arm"],
    status: "alive",
  };

  it("returns the card fields it checked", () => {
    const parsed = livingCardFromJson(card, "fighter A");
    assert.equal(parsed.subname, "freddy");
    assert.equal(parsed.look, "burned face");
    assert.deepEqual(parsed.injuries, ["scarred arm"]);
    assert.equal(parsed.status, "alive");
  });

  it("names a missing field and a roster label that is not subname", () => {
    assert.throws(
      () =>
        livingCardFromJson(
          { ...card, subname: undefined, label: "freddy" },
          "fighter A",
        ),
      /fighter A subname must be a non-empty string.*label="freddy"/s,
    );
  });

  it("rejects a card with no look", () => {
    assert.throws(
      () => livingCardFromJson({ ...card, look: "" }, "card.json"),
      /card.json look must be a non-empty string/,
    );
  });

  it("rejects injuries that are not strings", () => {
    assert.throws(
      () => livingCardFromJson({ ...card, injuries: [1] }, "card.json"),
      /card.json injuries\[0\] must be a non-empty string/,
    );
  });
});

describe("loadDemoConfigs", () => {
  const narrationEnv = {
    NARRATION_PROVIDER: "anthropic",
    NARRATION_MODEL: PRODUCTION_NARRATION_MODEL,
    FIGHT_VIDEO_SECONDS: "10",
    ANTHROPIC_API_KEY: "sk-test",
  };

  it("returns narration and fal config from the same env", () => {
    const { falConfig, narrationConfig } = loadDemoConfigs({
      ...narrationEnv,
      FAL_KEY: "fal-test",
      FAL_MODEL: "minimax/h3-max/text-to-video",
      FAL_VIDEO_RESOLUTION: "768P",
      FAL_PROMPT_EXPANSION_MODE: "balanced",
      FAL_ASPECT_RATIO: "16:9",
    });
    assert.equal(narrationConfig.model, PRODUCTION_NARRATION_MODEL);
    assert.equal(falConfig.model, "minimax/h3-max/text-to-video");
    assert.equal(falConfig.apiKey, "fal-test");
  });

  it("fails on a missing fal variable without needing a narration response", () => {
    assert.throws(
      () => loadDemoConfigs(narrationEnv),
      /FAL_KEY is required/,
    );
  });
});

describe("demo argv", () => {
  it("fails before narration when --a is missing", async () => {
    await assert.rejects(() => main(["--b", "card.json"]), /missing --a/);
  });
});
