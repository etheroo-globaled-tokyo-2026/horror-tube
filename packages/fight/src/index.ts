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
import type { FightInput, FightTurnResult } from "./types.js";

export * from "./types.js";
export * from "./env.js";
export * from "./validate.js";
export * from "./render.js";
export * from "./narrate.js";
export * from "./fal-video.js";
export * from "./rotation.js";

export async function runFightTurn(
  input: FightInput,
  env: Record<string, string | undefined> = process.env,
  deps: {
    narration?: NarrationProviderClient;
    fal?: FalClient;
    narrationConfig?: NarrationConfig;
    falConfig?: FalVideoConfig;
  } = {},
): Promise<FightTurnResult> {
  const narrationConfig = deps.narrationConfig ?? loadNarrationConfig(env);
  const falConfig = deps.falConfig ?? loadFalVideoConfig(env);
  const narrated: NarrationResult = await narrateFight(
    input,
    narrationConfig,
    deps.narration,
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
