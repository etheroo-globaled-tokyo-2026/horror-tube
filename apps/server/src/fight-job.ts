import { randomUUID } from "node:crypto";

import {
  loadFalVideoConfig,
  runFightTurn,
  type FightInput,
  type LivingCard,
} from "@horror-tube/fight";
import type { BattleQueueInsert } from "@horror-tube/fight/battle-queue";

import type { VideoStyle } from "./types.js";

export type FightJobRequest = {
  /** On-chain BattleBetting id as a decimal string. */
  battleId: string;
  fighterASubname: string;
  fighterBSubname: string;
  /** Living roster labels (GameLoop holding copy). Includes both fighters. */
  livingSubnames: string[];
  /** Prior bout last-frame CDN URL; null/omit for text-to-video. */
  priorFrameUrl: string | null;
  round: number;
};

export type FightJobResult = {
  insert: BattleQueueInsert;
  winnerSide: 0 | 1;
  damage: number;
  videoUrl: string;
  videoStyle: VideoStyle;
  durationMs: number;
  frameUrl: string;
};

export type FightJobRunner = (request: FightJobRequest) => Promise<FightJobResult>;

export type LoadLivingCards = (
  subnames: readonly string[],
) => Promise<LivingCard[]>;

export type RunFightTurnFn = typeof runFightTurn;

function livingCardMap(cards: LivingCard[]): Map<string, LivingCard> {
  const map = new Map<string, LivingCard>();
  for (const card of cards) {
    if (map.has(card.subname)) {
      throw new Error(
        `loadLivingCards returned duplicate subname ${JSON.stringify(card.subname)}.`,
      );
    }
    map.set(card.subname, card);
  }
  return map;
}

function requireCard(
  map: Map<string, LivingCard>,
  subname: string,
  role: string,
): LivingCard {
  const card = map.get(subname);
  if (card === undefined) {
    throw new Error(
      `Fight job missing ${role} card for ${JSON.stringify(subname)}. ENS load did not return it.`,
    );
  }
  if (card.status !== "alive") {
    throw new Error(
      `Fight job ${role} ${JSON.stringify(subname)} is not alive on ENS (status=${JSON.stringify(card.status)}).`,
    );
  }
  return card;
}

export function buildFightInput(
  request: FightJobRequest,
  cards: LivingCard[],
): FightInput {
  const map = livingCardMap(cards);
  const fighterA = requireCard(map, request.fighterASubname, "fighterA");
  const fighterB = requireCard(map, request.fighterBSubname, "fighterB");
  const eligibleOpponents = request.livingSubnames
    .filter(
      (label) =>
        label !== request.fighterASubname && label !== request.fighterBSubname,
    )
    .map((label) => requireCard(map, label, "eligible opponent"));
  return { fighterA, fighterB, eligibleOpponents };
}

export function fightJobResultFromTurn(
  request: FightJobRequest,
  turn: {
    shots: BattleQueueInsert["shots"];
    ensLines: BattleQueueInsert["ensLines"];
    rationale: string;
    winnerSubname: string;
    loserSubname: string;
    winnerInjuries: string[];
    nextOpponentSubname: string;
    videoUrl: string;
    videoStyle: VideoStyle;
    frameUrl: string;
  },
  durationMs: number,
  id: string = randomUUID(),
): FightJobResult {
  let winnerSide: 0 | 1;
  if (turn.winnerSubname === request.fighterASubname) {
    winnerSide = 0;
  } else if (turn.winnerSubname === request.fighterBSubname) {
    winnerSide = 1;
  } else {
    throw new Error(
      `Fight narration winner ${JSON.stringify(turn.winnerSubname)} is neither fighterA ${JSON.stringify(request.fighterASubname)} nor fighterB ${JSON.stringify(request.fighterBSubname)}.`,
    );
  }
  if (
    turn.loserSubname !== request.fighterASubname &&
    turn.loserSubname !== request.fighterBSubname
  ) {
    throw new Error(
      `Fight narration loser ${JSON.stringify(turn.loserSubname)} is not one of the bout fighters.`,
    );
  }
  if (turn.loserSubname === turn.winnerSubname) {
    throw new Error(
      `Fight narration winner and loser are the same subname ${JSON.stringify(turn.winnerSubname)}.`,
    );
  }
  const insert: BattleQueueInsert = {
    id,
    battleId: request.battleId,
    fighterASubname: request.fighterASubname,
    fighterBSubname: request.fighterBSubname,
    shots: turn.shots,
    ensLines: turn.ensLines,
    rationale: turn.rationale,
    winnerSubname: turn.winnerSubname,
    loserSubname: turn.loserSubname,
    winnerInjuries: turn.winnerInjuries,
    nextOpponentSubname: turn.nextOpponentSubname,
  };
  return {
    insert,
    winnerSide,
    damage: turn.winnerInjuries.length,
    videoUrl: turn.videoUrl,
    videoStyle: turn.videoStyle,
    durationMs,
    frameUrl: turn.frameUrl,
  };
}

/**
 * Builds the production fight runner. Loads living cards, calls runFightTurn,
 * and maps the result for GameLoop. Missing FAL/narration/Spaces env fails when
 * the job runs (named by those loaders). No demo-fight fallback.
 */
export function createFightJobRunner(deps: {
  loadLivingCards: LoadLivingCards;
  runTurn?: RunFightTurnFn;
  env?: NodeJS.ProcessEnv;
}): FightJobRunner {
  const runTurn = deps.runTurn ?? runFightTurn;
  const env = deps.env ?? process.env;
  return async (request) => {
    const needed = new Set(request.livingSubnames);
    needed.add(request.fighterASubname);
    needed.add(request.fighterBSubname);
    const cards = await deps.loadLivingCards([...needed]);
    const input = buildFightInput(request, cards);
    const prior =
      request.priorFrameUrl === null || request.priorFrameUrl.trim() === ""
        ? undefined
        : request.priorFrameUrl.trim();
    const falConfig = loadFalVideoConfig(env);
    const result = await runTurn(input, env, {
      priorFrameUrl: prior,
      falConfig,
    });
    return fightJobResultFromTurn(
      request,
      {
        shots: result.turn.shots,
        ensLines: result.ensLines,
        rationale: result.rationale,
        winnerSubname: result.turn.winner_subname,
        loserSubname: result.turn.loser_subname,
        winnerInjuries: result.turn.winner_injuries,
        nextOpponentSubname: result.nextOpponentSubname,
        videoUrl: result.videoUrl,
        videoStyle: result.videoStyle,
        frameUrl: result.frameUrl,
      },
      falConfig.durationSeconds * 1000,
    );
  };
}

export type { LivingCard, FightInput };
