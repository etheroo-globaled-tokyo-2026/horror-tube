import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

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

describe("runFightTurn", () => {
  it("narrates then builds a fal payload from a saved response shape", async () => {
    const turn = validModelTurn();
    const saved = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      video: { url: string };
      expanded_prompt: string;
    };
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
      randomInt: () => 0,
    });
    assert.equal(result.videoUrl, saved.video.url);
    assert.equal(result.expandedPrompt, saved.expanded_prompt);
    assert.equal(result.ensLines[0], "freddy|status=dead");
    assert.equal(result.nextOpponentSubname, "leatherface");
    assert.equal(result.rationale, turn.rationale);
    assert.equal(result.videoPrompt.includes(turn.rationale), false);
    assert.equal(result.videoPrompt.includes("status=dead"), false);
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
