import {
  uploadFightFrame,
  uploadFightVideo,
  type FightMediaConfig,
  type PutFightVideo,
} from "@horror-tube/fight-media";

import {
  loadFalVideoConfig,
  loadNarrationConfig,
  type FalVideoConfig,
  type NarrationConfig,
} from "./env.js";
import { extractLastFrameJpeg, type RunFfmpeg } from "./extract-frame.js";
import { generateFightVideo, type FalClient } from "./fal-video.js";
import {
  narrateFight,
  type NarrationProviderClient,
  type NarrationResult,
} from "./narrate.js";
import {
  downloadFightVideoBytes,
  type FetchLike,
} from "./store-video.js";
import type { FightInput, FightTurnResult } from "./types.js";

export * from "./types.js";
export * from "./env.js";
export * from "./validate.js";
export * from "./render.js";
export * from "./narrate.js";
export * from "./fal-video.js";
export * from "./rotation.js";
export * from "./pairing.js";
export * from "./battle-queue.js";
export * from "./store-video.js";
export * from "./extract-frame.js";

export async function runFightTurn(
  input: FightInput,
  env: Record<string, string | undefined> = process.env,
  deps: {
    narration?: NarrationProviderClient;
    fal?: FalClient;
    narrationConfig?: NarrationConfig;
    falConfig?: FalVideoConfig;
    fetch?: FetchLike;
    fightMediaConfig?: FightMediaConfig;
    putObject?: PutFightVideo;
    priorFrameUrl?: string;
    extractLastFrame?: (
      mp4Bytes: Uint8Array,
      runFfmpeg?: RunFfmpeg,
    ) => Promise<Uint8Array>;
    runFfmpeg?: RunFfmpeg;
  } = {},
): Promise<FightTurnResult> {
  const narrationConfig = deps.narrationConfig ?? loadNarrationConfig(env);
  const falConfig = deps.falConfig ?? loadFalVideoConfig(env);
  const narrated: NarrationResult = await narrateFight(input, narrationConfig, deps.narration);
  const video = await generateFightVideo(
    narrated.turn,
    falConfig,
    deps.fal,
    { priorFrameUrl: deps.priorFrameUrl },
  );
  const body = await downloadFightVideoBytes(video.videoUrl, deps.fetch);
  const videoUrl = await uploadFightVideo({
    body,
    env,
    config: deps.fightMediaConfig,
    putObject: deps.putObject,
  });

  const extract = deps.extractLastFrame ?? extractLastFrameJpeg;
  const frameBytes = await extract(body, deps.runFfmpeg);
  const frameUrl = await uploadFightFrame({
    body: frameBytes,
    env,
    config: deps.fightMediaConfig,
    putObject: deps.putObject,
  });

  return {
    turn: narrated.turn,
    ensLines: narrated.ensLines,
    rationale: narrated.rationale,
    videoPrompt: video.prompt,
    videoUrl,
    frameUrl,
    expandedPrompt: video.expandedPrompt,
  };
}
