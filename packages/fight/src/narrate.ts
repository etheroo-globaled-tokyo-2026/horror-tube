import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { FightError, type NarrationConfig } from "./env.js";
import {
  ARENA_VIDEO_PROMPT_PREFIX,
  assertEnsLinesLegal,
  renderEnsLines,
  videoPromptFromTurn,
} from "./render.js";
import { narrationModelTurnSchema, type FightInput, type NarrationModelTurn } from "./types.js";
import { validateFightInput, validateNarrationTurn } from "./validate.js";

export type { NarrationModelTurn };

export const narrationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "shots",
    "loser_subname",
    "winner_subname",
    "winner_injuries",
    "rationale",
  ],
  properties: {
    shots: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["time_range", "characters", "action", "camera", "style"],
        properties: {
          time_range: {
            type: "string",
            description: 'Timed beat for this shot, e.g. "0-4s".',
          },
          characters: {
            type: "string",
            description:
              "Visible looks for the fighters in this shot. Copy look text; restate each carried injury word for word.",
          },
          action: {
            type: "string",
            description:
              "Visible action. Death and any new winner injury must happen on camera.",
          },
          camera: {
            type: "string",
            description: "Camera move for this beat.",
          },
          style: {
            type: "string",
            description:
              "Visual style. No readable on-screen text. No extra people.",
          },
        },
      },
    },
    loser_subname: {
      type: "string",
      description: "ENS subname of the fighter who dies.",
    },
    winner_subname: {
      type: "string",
      description: "ENS subname of the fighter who survives.",
    },
    winner_injuries: {
      type: "array",
      items: { type: "string" },
      description:
        "Full injury list the video shows: every injury on the winner's card plus new damage. Copy each phrase word for word from the shot text. Use [] only when the winner card was unhurt and no new damage appears.",
    },
    rationale: {
      type: "string",
      description:
        "Short why this fighter wins. Stored by the app; never sent to the video model.",
    },
  },
} as const;

export type NarrationJsonSchema = typeof narrationSchema;

export const NARRATION_MAX_ATTEMPTS = 3;

export type NarrationProviderClient = {
  complete: (args: {
    system: string;
    user: string;
    schema: NarrationJsonSchema;
  }) => Promise<NarrationModelTurn>;
};

export type NarrationResult = {
  turn: NarrationModelTurn;
  ensLines: [string, string];
  rationale: string;
  videoPrompt: string;
};

export function assertTurnContractText(
  text: string,
  turn: NarrationModelTurn,
): void {
  const expected = renderEnsLines(turn);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length > 2) {
    throw new FightError(
      `extra trailing lines after the ENS pair are rejected. Got ${lines.length} lines.`,
    );
  }
  if (lines.length !== 2) {
    throw new FightError(
      `ENS contract requires exactly two lines (loser then winner). Got ${lines.length}.`,
    );
  }
  assertEnsLinesLegal(lines);
  if (lines[1] !== expected[1]) {
    throw new FightError(
      `winner line is not last (or does not match injuries). Expected ${JSON.stringify(expected[1])}, got ${JSON.stringify(lines[1])}.`,
    );
  }
  if (lines[0] !== expected[0]) {
    throw new FightError(
      `loser line must be first. Expected ${JSON.stringify(expected[0])}, got ${JSON.stringify(lines[0])}.`,
    );
  }
}

export async function narrateFight(
  input: FightInput,
  config: NarrationConfig,
  client: NarrationProviderClient = providerClient(config),
  log: (line: string) => void = (line) => console.warn(line),
): Promise<NarrationResult> {
  validateFightInput(input);
  const fight = `${input.fighterA.subname} vs ${input.fighterB.subname}`;
  const system = buildSystemPrompt(config.fightVideoSeconds);
  const user = buildUserPrompt(input);
  const rejected: string[] = [];
  let prompt = user;
  for (let attempt = 1; attempt <= NARRATION_MAX_ATTEMPTS; attempt += 1) {
    let turn: NarrationModelTurn;
    try {
      turn = await client.complete({ system, user: prompt, schema: narrationSchema });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new FightError(
        `narration for ${fight}: ${config.provider} ${config.model} request failed: ${detail}`,
        { cause: err },
      );
    }
    try {
      return checkedNarration(turn, input);
    } catch (err) {
      if (!(err instanceof FightError)) throw err;
      const line = `attempt ${String(attempt)}/${String(NARRATION_MAX_ATTEMPTS)} rejected: ${err.message}`;
      rejected.push(line);
      log(`narration ${fight} ${config.provider} ${config.model} ${line} answer=${JSON.stringify(turn)}`);
      prompt = retryPrompt(user, turn, err.message);
    }
  }
  throw new FightError(
    `narration for ${fight} failed after ${String(NARRATION_MAX_ATTEMPTS)} attempt(s) with ${config.provider} ${config.model}: ${rejected.join(" | ")}`,
  );
}

function checkedNarration(turn: NarrationModelTurn, input: FightInput): NarrationResult {
  validateNarrationTurn(turn, input);
  const ensLines = renderEnsLines(turn);
  assertEnsLinesLegal(ensLines);
  assertTurnContractText(`${ensLines[0]}\n${ensLines[1]}`, turn);
  return {
    turn,
    ensLines,
    rationale: turn.rationale,
    videoPrompt: videoPromptFromTurn(turn),
  };
}

function retryPrompt(user: string, turn: NarrationModelTurn, reason: string): string {
  return [
    user,
    "",
    `Your previous answer was rejected: ${reason}`,
    "Previous answer:",
    JSON.stringify(turn, null, 2),
    "Answer again with the full corrected JSON. Copy every winner_injuries item word for word from the shot text.",
  ].join("\n");
}

export function providerClient(config: NarrationConfig): NarrationProviderClient {
  if (config.provider === "anthropic") {
    return anthropicClient(config);
  }
  return geminiClient(config);
}

function anthropicClient(config: NarrationConfig): NarrationProviderClient {
  const client = new Anthropic({ apiKey: config.apiKey });
  return {
    async complete({ system, user, schema }) {
      const message = await client.messages.parse({
        model: config.model,
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          format: jsonSchemaOutputFormat(schema),
        },
      });
      const turn = narrationModelTurnSchema.safeParse(message.parsed_output);
      if (!turn.success) {
        throw new FightError(
          `Anthropic narration output does not match the narration schema: ${z.prettifyError(turn.error)}`,
        );
      }
      return turn.data;
    },
  };
}

function geminiClient(config: NarrationConfig): NarrationProviderClient {
  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  return {
    async complete({ system, user, schema }) {
      const response = await ai.models.generateContent({
        model: config.model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      });
      const text = response.text;
      if (text === undefined || text.trim() === "") {
        throw new FightError("Gemini returned empty text for narration JSON.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new FightError(
          `Gemini returned non-JSON narration output: ${text.slice(0, 500)}`,
          { cause: err },
        );
      }
      const turn = narrationModelTurnSchema.safeParse(parsed);
      if (!turn.success) {
        throw new FightError(
          `Gemini narration output does not match the narration schema: ${z.prettifyError(turn.error)}`,
        );
      }
      return turn.data;
    },
  };
}

function buildSystemPrompt(fightVideoSeconds: number): string {
  return [
    "You narrate one horror fight for a text-to-video model (MiniMax H3 Max).",
    `Target clip length is about ${fightVideoSeconds} seconds.`,
    "Pick exactly one winner from the two living fighters using their cards and what you already know about those horror characters.",
    "Do not fetch external lore. Do not invent a draw. One fighter dies on camera.",
    `The fight happens in this fixed arena: ${ARENA_VIDEO_PROMPT_PREFIX}`,
    "Every shot description must stay in that arena. Do not invent a different location (no boiler room, street, house, forest, or other setting).",
    "The two fighters start on opposite sides of the arena.",
    "The winner may take visible damage. winner_injuries lists every injury the winner ends with: each injury on the winner's card, copied exactly, plus any new damage.",
    "Each winner_injuries item must appear word for word in the shot text: write the injury phrase into a shot, then copy that same phrase into winner_injuries. Do not reword, reorder, or summarize it.",
    "Each shot needs: character looks, a timed beat (time_range), action, camera move, and style.",
    "No readable on-screen text. No extra people.",
    "Do not name a next opponent. The application pairs the next bout separately.",
    "Return only the structured fields. Application code will render ENS lines.",
  ].join(" ");
}

function buildUserPrompt(input: FightInput): string {
  const card = (c: FightInput["fighterA"]) =>
    JSON.stringify(
      {
        subname: c.subname,
        display_name: c.display_name,
        look: c.look,
        brief: c.brief,
        injuries: c.injuries,
        status: c.status,
      },
      null,
      2,
    );
  return [
    "Fighter A:",
    card(input.fighterA),
    "",
    "Fighter B:",
    card(input.fighterB),
    "",
    "Other living roster characters (context only; do not pick the next opponent):",
    JSON.stringify(
      input.eligibleOpponents.map((c) => ({
        subname: c.subname,
        display_name: c.display_name,
        look: c.look,
        brief: c.brief,
        injuries: c.injuries,
        status: c.status,
      })),
      null,
      2,
    ),
  ].join("\n");
}
