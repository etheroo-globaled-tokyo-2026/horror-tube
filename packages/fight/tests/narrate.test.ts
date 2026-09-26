import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  assertTurnContractText,
  NARRATION_MAX_ATTEMPTS,
  narrateFight,
  type NarrationProviderClient,
} from "../src/narrate.js";
import { renderEnsLines } from "../src/render.js";
import {
  livingCardSchema,
  narrationModelTurnSchema,
  type FightInput,
  type NarrationModelTurn,
} from "../src/types.js";
import { sampleFightInput, validModelTurn } from "./fixtures.js";
import type { NarrationConfig } from "../src/env.js";

const narrationCfg: NarrationConfig = {
  provider: "anthropic",
  model: "claude-test",
  fightVideoSeconds: 8,
  apiKey: "sk-test",
};

const paraphrase = z
  .object({
    fighterA: livingCardSchema,
    fighterB: livingCardSchema,
    rejected: narrationModelTurnSchema,
    corrected: narrationModelTurnSchema,
  })
  .parse(
    JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "narration-paraphrased-injury.json"),
        "utf8",
      ),
    ),
  );

const paraphraseBout = (): FightInput => ({
  fighterA: paraphrase.fighterA,
  fighterB: paraphrase.fighterB,
  eligibleOpponents: [],
});

function scripted(...answers: NarrationModelTurn[]) {
  const prompts: { system: string; user: string }[] = [];
  const client: NarrationProviderClient = {
    complete: async ({ system, user }) => {
      prompts.push({ system, user });
      const next = answers[prompts.length - 1];
      if (next === undefined) throw new Error("scripted client ran out of answers");
      return next;
    },
  };
  return { client, prompts };
}

function narrate(input: FightInput, client: NarrationProviderClient) {
  const logs: string[] = [];
  const run = narrateFight(input, narrationCfg, client, (line) => logs.push(line));
  return { run, logs };
}

describe("assertTurnContractText", () => {
  it("accepts loser line then winner line with nothing after", () => {
    const turn = validModelTurn();
    const [loser, winner] = renderEnsLines(turn);
    assert.doesNotThrow(() =>
      assertTurnContractText(`${loser}\n${winner}`, turn),
    );
  });

  it("rejects when the winner line is not last", () => {
    const turn = validModelTurn();
    const [loser, winner] = renderEnsLines(turn);
    assert.throws(
      () => assertTurnContractText(`${winner}\n${loser}`, turn),
      /winner.*last|not last/i,
    );
  });

  it("rejects extra trailing lines after the ENS pair", () => {
    const turn = validModelTurn();
    const [loser, winner] = renderEnsLines(turn);
    assert.throws(
      () => assertTurnContractText(`${loser}\n${winner}\nextra`, turn),
      /extra|trailing/i,
    );
  });

  it("rejects look/brief/icon field updates in the ENS lines", () => {
    const turn = validModelTurn();
    assert.throws(
      () =>
        assertTurnContractText(
          "freddy|status=dead\njason|look=new face",
          turn,
        ),
      /look|brief|icon/i,
    );
  });
});

describe("narrateFight", () => {
  it("validates structured provider output and tells the model not to name a next opponent", async () => {
    const modelTurn = validModelTurn();
    const { client, prompts } = scripted(modelTurn);
    const { run, logs } = narrate(sampleFightInput(), client);
    const result = await run;
    assert.equal(result.turn.winner_subname, "jason");
    assert.deepEqual(result.ensLines, renderEnsLines(result.turn));
    assert.equal(result.rationale, modelTurn.rationale);
    assert.deepEqual(logs, []);
    const systemPrompt = prompts[0]?.system ?? "";
    assert.match(
      systemPrompt,
      /Use a terrifying battle royale arena for the battle, each fighter starting on opposite sides\./,
    );
    assert.match(systemPrompt, /Do not invent a different location/);
    assert.match(systemPrompt, /opposite sides/);
    assert.match(systemPrompt, /Do not name a next opponent/);
  });

  it("asks again with the rejection when an injury label paraphrases the shots, logging the rejected answer", async () => {
    const { client, prompts } = scripted(paraphrase.rejected, paraphrase.corrected);
    const { run, logs } = narrate(paraphraseBout(), client);
    const result = await run;
    assert.deepEqual(result.turn, paraphrase.corrected);
    assert.equal(prompts.length, 2);
    const reason = 'injury phrase missing from the shot list: "torn shoulder of his robe"';
    assert.equal(logs.length, 1);
    assert.ok(logs[0]?.includes("jason vs pinhead"), logs[0]);
    assert.ok(logs[0]?.includes(`attempt 1/${String(NARRATION_MAX_ATTEMPTS)} rejected: ${reason}`), logs[0]);
    assert.ok(logs[0]?.includes(JSON.stringify(paraphrase.rejected)), "the log keeps the whole rejected answer");
    assert.ok(prompts[1]?.user.startsWith(prompts[0]?.user ?? ""), "the retry keeps the fighter cards");
    assert.ok(prompts[1]?.user.includes(reason), "the retry tells the model why it was rejected");
  });

  it("fails naming the fight and each rejection when an injury never appears in the shots", async () => {
    const missing = { ...paraphrase.rejected, winner_injuries: ["severed left hand"] };
    const { client, prompts } = scripted(...Array.from({ length: NARRATION_MAX_ATTEMPTS }, () => missing));
    const { run, logs } = narrate(paraphraseBout(), client);
    await assert.rejects(
      run,
      /narration for jason vs pinhead failed after \d+ attempt\(s\) with anthropic claude-test: attempt 1\/\d+ rejected: injury phrase missing from the shot list: "severed left hand"/u,
    );
    assert.equal(prompts.length, NARRATION_MAX_ATTEMPTS);
    assert.equal(logs.length, NARRATION_MAX_ATTEMPTS);
    for (const line of logs) {
      assert.ok(line.includes('missing from the shot list: "severed left hand"'), line);
    }
  });

  it("names the fight when the provider request fails, without asking again", async () => {
    const prompts: string[] = [];
    const { run, logs } = narrate(sampleFightInput(), {
      complete: async ({ user }) => {
        prompts.push(user);
        throw new Error("529 overloaded");
      },
    });
    await assert.rejects(run, /narration for freddy vs jason: anthropic claude-test request failed: 529 overloaded/u);
    assert.equal(prompts.length, 1);
    assert.deepEqual(logs, []);
  });
});
