import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { NarrationConfig, PairingConfig } from "../src/env.js";
import {
  pickPairing,
  type PairingInput,
  type PairingJsonSchema,
  type PairingModelOutput,
  type PairingProviderClient,
} from "../src/pairing.js";
import { fighterA, fighterB, livingOpponent, otherLiving } from "./fixtures.js";

const narration: NarrationConfig = {
  provider: "anthropic",
  model: "claude-test",
  fightVideoSeconds: 8,
  apiKey: "sk-test",
};

const pairing: PairingConfig = { maxAttempts: 3, timeoutMs: 1_000 };

const firstBout: PairingInput = { champion: null, candidates: [fighterA, fighterB, livingOpponent] };
const laterBout: PairingInput = { champion: fighterB, candidates: [fighterA, otherLiving] };

const answer = (a: string, b: string, rationale = "A good fight."): PairingModelOutput => ({
  fighter_a_subname: a,
  fighter_b_subname: b,
  rationale,
});

function scripted(...outputs: PairingModelOutput[]) {
  const calls: { user: string; schema: PairingJsonSchema }[] = [];
  const client = {
    complete: async ({ user, schema }: { user: string; schema: PairingJsonSchema }) => {
      calls.push({ user, schema });
      const next = outputs[calls.length - 1];
      if (next === undefined) throw new Error("scripted client ran out of answers");
      return next;
    },
  };
  return { client, calls };
}

async function run(input: PairingInput, client: PairingProviderClient, config = pairing) {
  const logs: string[] = [];
  const result = await pickPairing(input, narration, config, client, (line) => logs.push(line)).catch(
    (cause: unknown) => cause,
  );
  return { result, logs };
}

describe("pickPairing", () => {
  it("offers only living labels for a first bout and sends every card", async () => {
    const { client, calls } = scripted(answer("freddy", "leatherface"));
    const { result } = await run(firstBout, client);
    assert.deepEqual(result, {
      fighterASubname: "freddy",
      fighterBSubname: "leatherface",
      rationale: "A good fight.",
    });
    const properties = calls[0]?.schema.properties;
    assert.deepEqual(properties?.fighter_a_subname.enum, ["freddy", "jason", "leatherface"]);
    assert.deepEqual(properties?.fighter_b_subname.enum, ["freddy", "jason", "leatherface"]);
    for (const card of firstBout.candidates) {
      assert.ok(calls[0]?.user.includes(card.look), card.subname);
      assert.ok(calls[0]?.user.includes(card.brief), card.subname);
    }
  });

  it("pins the champion as fighter A with its injuries and offers only other living challengers", async () => {
    const { client, calls } = scripted(answer("jason", "chucky"));
    const { result } = await run(laterBout, client);
    assert.deepEqual(result, { fighterASubname: "jason", fighterBSubname: "chucky", rationale: "A good fight." });
    assert.deepEqual(calls[0]?.schema.properties.fighter_a_subname.enum, ["jason"]);
    assert.deepEqual(calls[0]?.schema.properties.fighter_b_subname.enum, ["freddy", "chucky"]);
    assert.match(calls[0]?.user ?? "", /cracked mask/u);
  });

  it("asks again after an output the schema rejects, logging each rejected output", async () => {
    const { client, calls } = scripted(
      answer("freddy", "freddy"),
      answer("freddy", "pinhead"),
      answer("freddy", "jason"),
    );
    const { result, logs } = await run(firstBout, client);
    assert.deepEqual(result, { fighterASubname: "freddy", fighterBSubname: "jason", rationale: "A good fight." });
    assert.equal(calls.length, 3);
    assert.equal(logs.length, 2);
    assert.match(logs[0] ?? "", /attempt 1\/3 rejected: .*"fighter_b_subname":"freddy".*must be different/su);
    assert.match(logs[1] ?? "", /attempt 2\/3 rejected: .*"fighter_b_subname":"pinhead"/su);
  });

  it("fails after the last attempt naming every rejected output", async () => {
    const { client } = scripted(answer("jason", "leatherface"), answer("freddy", "chucky"), answer("jason", ""));
    const { result } = await run(laterBout, client);
    assert.ok(result instanceof Error);
    assert.match(result.message, /pairing failed after 3 attempt\(s\) with anthropic claude-test/u);
    for (const bad of ['"leatherface"', '"fighter_a_subname":"freddy"', '"fighter_b_subname":""']) {
      assert.ok(result.message.includes(bad), bad);
    }
  });

  it("counts a call that outlives PAIRING_TIMEOUT_SECONDS as a rejected attempt", async () => {
    let aborted = false;
    const client = {
      complete: ({ signal }: { signal: AbortSignal }) =>
        new Promise<PairingModelOutput>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    };
    const { result } = await run(laterBout, client, { maxAttempts: 1, timeoutMs: 20 });
    assert.ok(result instanceof Error);
    assert.match(result.message, /attempt 1\/1 rejected: timed out after 0.02s \(PAIRING_TIMEOUT_SECONDS\)/u);
    assert.ok(aborted, "the provider request is aborted");
  });

  it("refuses an input that could pair a champion with itself or leave no opponent, before calling the model", async () => {
    const { client, calls } = scripted();
    for (const input of [
      { champion: fighterB, candidates: [fighterB, fighterA] },
      { champion: null, candidates: [fighterA] },
    ]) {
      const { result } = await run(input, client);
      assert.ok(result instanceof Error);
      assert.match(result.message, /pairing input is invalid/u);
    }
    assert.equal(calls.length, 0);
  });
});
