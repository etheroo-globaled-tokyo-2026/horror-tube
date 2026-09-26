import {
  loadFalVideoConfig,
  loadNarrationConfig,
  type FalVideoConfig,
  type NarrationConfig,
} from "./env.js";
import { generateFightVideo, type FalClient } from "./fal-video.js";
import {
  narrateFight,
  type NarrationProviderClient,
  type NarrationResult,
} from "./narrate.js";
import {
  cryptoRandomInt,
  nextRotationPair,
  type RandomInt,
  type RosterEntry,
} from "./rotation.js";
import type { FightInput, FightTurnResult, LivingCard } from "./types.js";

export * from "./types.js";
export * from "./env.js";
export * from "./validate.js";
export * from "./render.js";
export * from "./narrate.js";
export * from "./fal-video.js";
export * from "./rotation.js";
export * from "./battle-queue.js";

export { cryptoRandomInt };

/**
 * Bout start: previous winner vs a random living non-winner.
 * Builds FightInput so narration cannot pick a different pair.
 */
export function fightInputFromRotation(
  livingCards: readonly LivingCard[],
  winnerSubname: string,
  randomInt: RandomInt,
): FightInput {
  const roster: RosterEntry[] = livingCards.map((card) => ({
    subname: card.subname,
    status: "alive" as const,
  }));
  const pair = nextRotationPair(roster, winnerSubname, randomInt);
  const champion = livingCards.find(
    (card) => card.subname === pair.championSubname,
  );
  const challenger = livingCards.find(
    (card) => card.subname === pair.challengerSubname,
  );
  if (champion === undefined) {
    throw new Error(
      `fightInputFromRotation: champion ${JSON.stringify(pair.championSubname)} missing from living cards.`,
    );
  }
  if (challenger === undefined) {
    throw new Error(
      `fightInputFromRotation: challenger ${JSON.stringify(pair.challengerSubname)} missing from living cards.`,
    );
  }
  const eligibleOpponents = livingCards.filter(
    (card) =>
      card.subname !== champion.subname &&
      card.subname !== challenger.subname,
  );
  return {
    fighterA: champion,
    fighterB: challenger,
    eligibleOpponents,
  };
}

export async function runFightTurn(
  input: FightInput,
  env: Record<string, string | undefined> = process.env,
  deps: {
    narration?: NarrationProviderClient;
    fal?: FalClient;
    narrationConfig?: NarrationConfig;
    falConfig?: FalVideoConfig;
    randomInt?: RandomInt;
  } = {},
): Promise<FightTurnResult> {
  const narrationConfig = deps.narrationConfig ?? loadNarrationConfig(env);
  const falConfig = deps.falConfig ?? loadFalVideoConfig(env);
  const randomInt = deps.randomInt ?? cryptoRandomInt;
  const narrated: NarrationResult = await narrateFight(
    input,
    narrationConfig,
    deps.narration,
    randomInt,
  );
  const video = await generateFightVideo(
    narrated.turn,
    falConfig,
    deps.fal,
  );
  return {
    turn: narrated.turn,
    ensLines: narrated.ensLines,
    nextOpponentSubname: narrated.nextOpponentSubname,
    rationale: narrated.rationale,
    videoPrompt: narrated.videoPrompt,
    videoUrl: video.videoUrl,
    expandedPrompt: video.expandedPrompt,
  };
}
