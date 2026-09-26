import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  FightError,
  loadFalVideoConfig,
  loadNarrationConfig,
  type NarrationConfig,
} from "./env.js";
import { generateFightVideo } from "./fal-video.js";
import { narrateFight } from "./narrate.js";
import { cryptoRandomInt } from "./rotation.js";
import {
  livingCardSchema,
  type FightInput,
  type LivingCard,
} from "./types.js";
import { validateFightInput } from "./validate.js";

export const PRODUCTION_NARRATION_MODEL = "claude-sonnet-5";

function usage(): string {
  return [
    "Usage: pnpm --filter @horror-tube/fight demo -- --a <card.json> --b <card.json> [--opponents <file.json>]",
    `Loads two living cards and runs one fight. Narration uses Anthropic ${PRODUCTION_NARRATION_MODEL} from .env, then fal video.`,
    "Prints the fal video URL. Does not upload the mp4 or write ENS.",
  ].join("\n");
}

export function assertProductionNarration(config: NarrationConfig): void {
  if (
    config.provider !== "anthropic" ||
    config.model !== PRODUCTION_NARRATION_MODEL
  ) {
    throw new FightError(
      `Fight demo must use production narration: NARRATION_PROVIDER=anthropic and NARRATION_MODEL=${PRODUCTION_NARRATION_MODEL}. Got provider ${JSON.stringify(config.provider)} model ${JSON.stringify(config.model)}. Set them in .env. See .env.example.`,
    );
  }
}

function loadRepoEnv(): void {
  const envPath = new URL("../../../.env", import.meta.url);
  if (!existsSync(envPath)) {
    return;
  }
  const result = loadDotenv({ path: envPath });
  if (result.error !== undefined) {
    throw new FightError(
      `failed to read ${JSON.stringify(envPath.pathname)}: ${result.error.message}`,
      { cause: result.error },
    );
  }
}

function requireFlag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  if (index === -1) {
    throw new FightError(`missing ${name}.\n${usage()}`);
  }
  const value = argv[index + 1];
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    throw new FightError(`${name} requires a path argument.\n${usage()}`);
  }
  return value;
}

function optionalFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.trim() === "" || value.startsWith("--")) {
    throw new FightError(`${name} requires a path argument.\n${usage()}`);
  }
  return value;
}

const jsonValueSchema = z.json();
type JsonValue = z.infer<typeof jsonValueSchema>;

const rosterRowSchema = z.object({ label: z.string() });

function readJsonFile(path: string): JsonValue {
  const absolute = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new FightError(
      `failed to read ${JSON.stringify(absolute)}: ${detail}`,
      { cause: err },
    );
  }
  try {
    return jsonValueSchema.parse(JSON.parse(raw));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new FightError(
      `invalid JSON in ${JSON.stringify(absolute)}: ${detail}`,
      { cause: err },
    );
  }
}

function fieldPath(path: readonly PropertyKey[]): string {
  return path
    .map((key) =>
      Number.isInteger(key) ? `[${String(key)}]` : ` ${String(key)}`,
    )
    .join("");
}

export function livingCardFromJson(value: JsonValue, label: string): LivingCard {
  const card = livingCardSchema.safeParse(value, { reportInput: true });
  if (card.success) {
    return card.data;
  }
  const problems = card.error.issues.map(
    (issue) =>
      `${label}${fieldPath(issue.path)} ${issue.message}. Got: ${JSON.stringify(issue.input)}.`,
  );
  const rosterRow = rosterRowSchema.safeParse(value);
  if (
    rosterRow.success &&
    card.error.issues.some((issue) => issue.path[0] === "subname")
  ) {
    problems.push(
      `This file has label=${JSON.stringify(rosterRow.data.label)}. The demo card needs subname.`,
    );
  }
  throw new FightError(problems.join("\n"));
}

function loadLivingCard(path: string, label: string): LivingCard {
  return livingCardFromJson(readJsonFile(path), label);
}

function loadOpponents(path: string): LivingCard[] {
  const value = readJsonFile(path);
  if (!Array.isArray(value)) {
    throw new FightError(
      `opponents file must be a JSON array. Got: ${JSON.stringify(value)}`,
    );
  }
  return value.map((entry, index) =>
    livingCardFromJson(entry, `opponents[${index}]`),
  );
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const pathA = requireFlag(argv, "--a");
  const pathB = requireFlag(argv, "--b");
  const opponentsPath = optionalFlag(argv, "--opponents");

  const fighterA = loadLivingCard(pathA, "fighter A");
  const fighterB = loadLivingCard(pathB, "fighter B");
  const eligibleOpponents =
    opponentsPath === undefined ? [] : loadOpponents(opponentsPath);

  const input: FightInput = {
    fighterA,
    fighterB,
    eligibleOpponents,
  };
  validateFightInput(input);

  loadRepoEnv();
  const { narrationConfig, falConfig } = loadDemoConfigs(process.env);

  const narrated = await narrateFight(
    input,
    narrationConfig,
    undefined,
    cryptoRandomInt,
  );
  const video = await generateFightVideo(narrated.turn, falConfig);
  process.stdout.write(
    [
      `narration_model=${narrationConfig.model}`,
      `winner_subname=${narrated.turn.winner_subname}`,
      `videoPrompt=${narrated.videoPrompt}`,
      `videoUrl=${video.videoUrl}`,
      "",
    ].join("\n"),
  );
}

export function loadDemoConfigs(env: Record<string, string | undefined>) {
  const narrationConfig = loadNarrationConfig(env);
  assertProductionNarration(narrationConfig);
  const falConfig = loadFalVideoConfig(env);
  return { narrationConfig, falConfig };
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(resolve(entry)).href
) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
