import {
  uploadFightFrame,
  uploadFightVideo,
  type FightMediaConfig,
  type PutFightVideo,
} from "@horror-tube/fight-media";

import { applyDemonSound } from "./demon-sound.js";
import {
  loadFalVideoConfig,
  loadNarrationConfig,
  loadVideoEffectsConfig,
  type FalVideoConfig,
  type NarrationConfig,
  type RotoscopeConfig,
  type VideoEffectsConfig,
} from "./env.js";
import { extractLastFrameJpeg, type RunFfmpeg } from "./extract-frame.js";
import { generateFightVideo, type FalClient } from "./fal-video.js";
import {
  narrateFight,
  type NarrationProviderClient,
} from "./narrate.js";
import {
  cryptoRandomInt,
  nextRotationPair,
  type RandomInt,
  type RosterEntry,
} from "./rotation.js";
import { rotoscopeVideo, type RotoscopeResult } from "./rotoscope.js";
import { buildShotList, type RotoscopeShotList } from "./shot-list.js";
import {
  downloadFightVideoBytes,
  type FetchLike,
} from "./store-video.js";
import type { FightInput, FightTurnResult, LivingCard } from "./types.js";

export * from "./types.js";
export * from "./env.js";
export * from "./validate.js";
export * from "./render.js";
export * from "./narrate.js";
export * from "./fal-video.js";
export * from "./rotation.js";
export * from "./battle-queue.js";
export * from "./store-video.js";
export * from "./extract-frame.js";
export * from "./shot-list.js";
export * from "./rotoscope.js";
export * from "./demon-sound.js";

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

type Mp4Step = (
  mp4Bytes: Uint8Array,
  runFfmpeg?: RunFfmpeg,
) => Promise<Uint8Array>;

export type FightTurnDeps = {
  narration?: NarrationProviderClient;
  fal?: FalClient;
  narrationConfig?: NarrationConfig;
  falConfig?: FalVideoConfig;
  /** Override DEMON_SOUND / ROTOSCOPE* instead of reading env. */
  videoEffects?: VideoEffectsConfig;
  randomInt?: RandomInt;
  /** Injectable HTTP for the fal mp4 download. Defaults to global fetch. */
  fetch?: FetchLike;
  /** Override Spaces config instead of reading FIGHT_MEDIA_SPACES_* from env. */
  fightMediaConfig?: FightMediaConfig;
  /** Injectable Spaces PUT for video and frame. Defaults to the fight-media S3 client. */
  putObject?: PutFightVideo;
  /**
   * CDN URL of the previous fight's last frame. First bout in a chain omits
   * this (text-to-video). Later bouts must pass it (image-to-video).
   */
  priorFrameUrl?: string;
  /** Injectable last-frame extract. Defaults to ffmpeg. */
  extractLastFrame?: Mp4Step;
  /** Injectable demon sound. Defaults to ffmpeg. */
  applyDemonSound?: Mp4Step;
  /** Injectable rotoscope call. Defaults to the HTTP client for `rotoscope serve`. */
  rotoscopeVideo?: (
    mp4: Uint8Array,
    shotList: RotoscopeShotList,
    config: RotoscopeConfig,
  ) => Promise<RotoscopeResult>;
  runFfmpeg?: RunFfmpeg;
  /** Progress and timing lines. Defaults to console.log. */
  log?: (line: string) => void;
};

export async function runFightTurn(
  input: FightInput,
  env: Record<string, string | undefined> = process.env,
  deps: FightTurnDeps = {},
): Promise<FightTurnResult> {
  const narrationConfig = deps.narrationConfig ?? loadNarrationConfig(env);
  const falConfig = deps.falConfig ?? loadFalVideoConfig(env);
  const effects = deps.videoEffects ?? loadVideoEffectsConfig(env);
  const randomInt = deps.randomInt ?? cryptoRandomInt;
  const log = deps.log ?? console.log;
  const prefix = `fight ${input.fighterA.subname} vs ${input.fighterB.subname}`;
  log(
    `${prefix}: demon sound ${effects.demonSound ? "on" : "off"}, rotoscope ${
      effects.rotoscope === null
        ? "off"
        : `on at ${effects.rotoscope.url} (limit ${String(effects.rotoscope.timeoutMs)} ms)`
    }`,
  );
  const step = stepRunner(log, prefix);
  const bytes = (b: Uint8Array) => `${String(b.byteLength)} bytes`;

  const narrated = await step(
    "narration",
    () => narrateFight(input, narrationConfig, deps.narration, randomInt),
    (n) => `winner ${n.turn.winner_subname}`,
  );
  // Built before fal runs, so a turn the rotoscope can't read fails before the video is paid for.
  const rotoscopeJob =
    effects.rotoscope === null
      ? null
      : { config: effects.rotoscope, shotList: buildShotList(narrated.turn.shots, input) };
  const video = await step(
    "fal video",
    () =>
      generateFightVideo(narrated.turn, falConfig, deps.fal, {
        priorFrameUrl: deps.priorFrameUrl,
      }),
    (v) => `${v.model} request ${v.requestId}`,
  );
  const filmed = await step(
    "download",
    () => downloadFightVideoBytes(video.videoUrl, deps.fetch),
    bytes,
  );
  // The next bout's image-to-video starts from this frame, so it must be fal's footage.
  const extract = deps.extractLastFrame ?? extractLastFrameJpeg;
  const frameBytes = await step(
    "last frame",
    () => extract(filmed, deps.runFfmpeg),
    bytes,
  );

  const demon = deps.applyDemonSound ?? applyDemonSound;
  const voiced = effects.demonSound
    ? await step("demon sound", () => demon(filmed, deps.runFfmpeg), bytes)
    : filmed;

  const draw = deps.rotoscopeVideo ?? rotoscopeVideo;
  const finished =
    rotoscopeJob === null
      ? voiced
      : (
          await step(
            "rotoscope",
            () => draw(voiced, rotoscopeJob.shotList, rotoscopeJob.config),
            (r) =>
              `${bytes(r.video)}; the service drew ${String(r.frames ?? "?")} frames in ${String(r.seconds ?? "?")} s`,
          )
        ).video;

  const videoUrl = await step(
    "upload video",
    () =>
      uploadFightVideo({
        body: finished,
        env,
        config: deps.fightMediaConfig,
        putObject: deps.putObject,
      }),
    (url) => url,
  );
  const frameUrl = await step(
    "upload frame",
    () =>
      uploadFightFrame({
        body: frameBytes,
        env,
        config: deps.fightMediaConfig,
        putObject: deps.putObject,
      }),
    (url) => url,
  );

  return {
    turn: narrated.turn,
    ensLines: narrated.ensLines,
    nextOpponentSubname: narrated.nextOpponentSubname,
    rationale: narrated.rationale,
    videoPrompt: video.prompt,
    videoUrl,
    videoStyle: rotoscopeJob === null ? "film" : "rotoscope",
    frameUrl,
    expandedPrompt: video.expandedPrompt,
  };
}

/** Runs pipeline steps, logging each one's start, and its end or failure with the time taken. */
function stepRunner(log: (line: string) => void, prefix: string) {
  return async function step<T>(
    name: string,
    run: () => Promise<T>,
    describe: (value: T) => string,
  ): Promise<T> {
    const started = performance.now();
    const elapsed = () =>
      `${((performance.now() - started) / 1000).toFixed(1)} s`;
    log(`${prefix}: ${name} started`);
    try {
      const value = await run();
      log(`${prefix}: ${name} done in ${elapsed()} (${describe(value)})`);
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${prefix}: ${name} failed after ${elapsed()}: ${message}`);
      throw err;
    }
  };
}
