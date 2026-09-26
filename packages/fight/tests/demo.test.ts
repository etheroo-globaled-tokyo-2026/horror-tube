import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertProductionNarration,
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

describe("demo argv", () => {
  it("fails before narration when --a is missing", async () => {
    await assert.rejects(() => main(["--b", "card.json"]), /missing --a/);
  });
});
