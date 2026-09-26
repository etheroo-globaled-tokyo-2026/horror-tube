import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { FightError, type NarrationConfig, type PairingConfig } from "./env.js";
import { livingCardSchema, type LivingCard } from "./types.js";

export type PairingInput = { champion: LivingCard | null; candidates: LivingCard[] };

export type PairingResult = {
  fighterASubname: string;
  fighterBSubname: string;
  rationale: string;
};

type SubnameField = { type: "string"; enum: string[]; description: string };

export type PairingJsonSchema = {
  type: "object";
  additionalProperties: false;
  required: ["fighter_a_subname", "fighter_b_subname", "rationale"];
  properties: {
    fighter_a_subname: SubnameField;
    fighter_b_subname: SubnameField;
    rationale: { type: "string"; description: string };
  };
};

export const pairingModelOutputSchema = z.object({
  fighter_a_subname: z.string(),
  fighter_b_subname: z.string(),
  rationale: z.string(),
});

export type PairingModelOutput = z.infer<typeof pairingModelOutputSchema>;

export type PairingProviderClient = {
  complete: (args: {
    system: string;
    user: string;
    schema: PairingJsonSchema;
    signal: AbortSignal;
  }) => Promise<PairingModelOutput>;
};

const pairingInputSchema = z
  .object({ champion: livingCardSchema.nullable(), candidates: z.array(livingCardSchema) })
  .refine((input) => input.candidates.length >= (input.champion === null ? 2 : 1), {
    message: "a first bout needs at least two living candidates; a later bout needs at least one challenger",
  })
  .refine(
    (input) => new Set(input.candidates.map((c) => c.subname)).size === input.candidates.length,
    { message: "candidate subnames must be unique" },
  )
  .refine(
    (input) => input.champion === null || input.candidates.every((c) => c.subname !== input.champion?.subname),
    { message: "candidates must not include the champion" },
  );

function nonEmpty(labels: string[], role: string): [string, ...string[]] {
  const [first, ...rest] = labels;
  if (first === undefined) {
    throw new FightError(`pairing has no eligible ${role}.`);
  }
  return [first, ...rest];
}

function eligible(input: PairingInput) {
  const candidates = input.candidates.map((c) => c.subname);
  return {
    a: nonEmpty(input.champion === null ? candidates : [input.champion.subname], "fighter A"),
    b: nonEmpty(candidates, "fighter B"),
  };
}

export function pairingJsonSchema(input: PairingInput): PairingJsonSchema {
  const { a, b } = eligible(input);
  return {
    type: "object",
    additionalProperties: false,
    required: ["fighter_a_subname", "fighter_b_subname", "rationale"],
    properties: {
      fighter_a_subname: {
        type: "string",
        enum: a,
        description:
          input.champion === null ? "ENS subname of the first fighter." : "The champion's ENS subname, unchanged.",
      },
      fighter_b_subname: {
        type: "string",
        enum: b,
        description: "ENS subname of the opponent. Must differ from fighter_a_subname.",
      },
      rationale: { type: "string", description: "One or two sentences on why this matchup makes a good fight." },
    },
  };
}

export function pairingResultSchema(input: PairingInput) {
  const { a, b } = eligible(input);
  return z
    .object({
      fighter_a_subname: z.enum(a),
      fighter_b_subname: z.enum(b),
      rationale: z.string().regex(/\S/, "must be a non-empty string"),
    })
    .refine((out) => out.fighter_a_subname !== out.fighter_b_subname, {
      message: "fighter_a_subname and fighter_b_subname must be different fighters",
    });
}

export function buildPairingPrompt(input: PairingInput) {
  const card = (c: LivingCard) => ({
    subname: c.subname,
    display_name: c.display_name,
    look: c.look,
    brief: c.brief,
    injuries: c.injuries,
  });
  const task =
    input.champion === null
      ? "This is the first bout of the season. Choose both fighters from the candidate list."
      : "The champion stays on with the injuries on its card. fighter_a_subname is the champion. Choose the challenger from the candidate list.";
  return {
    system: [
      "You book one horror fight for a live broadcast.",
      task,
      "Choose from the cards (look, brief, injuries) and what you already know about these horror characters.",
      "Pick the matchup that makes the most interesting fight. Do not pick a winner.",
    ].join(" "),
    user: [
      ...(input.champion === null ? [] : ["Champion:", JSON.stringify(card(input.champion), null, 2), ""]),
      "Candidates (living):",
      JSON.stringify(input.candidates.map(card), null, 2),
    ].join("\n"),
  };
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new FightError(`timed out after ${String(timeoutMs / 1000)}s (PAIRING_TIMEOUT_SECONDS)`));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

export async function pickPairing(
  input: PairingInput,
  narration: NarrationConfig,
  pairing: PairingConfig,
  client: PairingProviderClient = pairingProviderClient(narration),
  log: (line: string) => void = (line) => console.warn(line),
): Promise<PairingResult> {
  const checked = pairingInputSchema.safeParse(input);
  if (!checked.success) {
    throw new FightError(`pairing input is invalid: ${z.prettifyError(checked.error)}`);
  }
  const { system, user } = buildPairingPrompt(input);
  const schema = pairingJsonSchema(input);
  const strict = pairingResultSchema(input);
  const rejected: string[] = [];
  for (let attempt = 1; attempt <= pairing.maxAttempts; attempt += 1) {
    let reason: string;
    try {
      const output = await withTimeout(
        (signal) => client.complete({ system, user, schema, signal }),
        pairing.timeoutMs,
      );
      const parsed = strict.safeParse(output);
      if (parsed.success) {
        return {
          fighterASubname: parsed.data.fighter_a_subname,
          fighterBSubname: parsed.data.fighter_b_subname,
          rationale: parsed.data.rationale,
        };
      }
      reason = `${JSON.stringify(output)}: ${z.prettifyError(parsed.error)}`;
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    const line = `attempt ${String(attempt)}/${String(pairing.maxAttempts)} rejected: ${reason}`;
    rejected.push(line);
    log(`pairing ${narration.provider} ${narration.model} ${line}`);
  }
  throw new FightError(
    `pairing failed after ${String(pairing.maxAttempts)} attempt(s) with ${narration.provider} ${narration.model}: ${rejected.join(" | ")}`,
  );
}

export function pairingProviderClient(config: NarrationConfig): PairingProviderClient {
  if (config.provider === "anthropic") {
    const client = new Anthropic({ apiKey: config.apiKey });
    return {
      async complete({ system, user, schema, signal }) {
        const message = await client.messages.parse(
          {
            model: config.model,
            max_tokens: 1024,
            system,
            messages: [{ role: "user", content: user }],
            output_config: { format: jsonSchemaOutputFormat(schema) },
          },
          { signal },
        );
        const output = pairingModelOutputSchema.safeParse(message.parsed_output);
        if (!output.success) {
          throw new FightError(
            `Anthropic pairing output does not match the pairing schema: ${z.prettifyError(output.error)}`,
          );
        }
        return output.data;
      },
    };
  }
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  return {
    async complete({ system, user, schema, signal }) {
      const response = await ai.models.generateContent({
        model: config.model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          abortSignal: signal,
        },
      });
      const text = response.text;
      if (text === undefined || text.trim() === "") {
        throw new FightError("Gemini returned empty text for pairing JSON.");
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new FightError(`Gemini returned non-JSON pairing output: ${text}`, { cause: err });
      }
      const output = pairingModelOutputSchema.safeParse(json);
      if (!output.success) {
        throw new FightError(
          `Gemini pairing output does not match the pairing schema: ${z.prettifyError(output.error)}`,
        );
      }
      return output.data;
    },
  };
}
