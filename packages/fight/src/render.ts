import { FightError } from "./env.js";
import type { NarrationTurn, Shot } from "./types.js";

export function formatShotList(shots: Shot[]): string {
  return shots
    .map((shot, index) => {
      const n = index + 1;
      return [
        `Shot ${n} (${shot.time_range})`,
        `Characters: ${shot.characters}`,
        `Action: ${shot.action}`,
        `Camera: ${shot.camera}`,
        `Style: ${shot.style}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function renderEnsLines(turn: NarrationTurn): [string, string] {
  const injuriesJson = JSON.stringify(turn.winner_injuries);
  const loser = `${turn.loser_subname}|status=dead`;
  const winner = `${turn.winner_subname}|injuries=${injuriesJson}`;
  return [loser, winner];
}

/** Fixed arena sentence prepended to every fal video prompt. Not written to ENS. */
export const ARENA_VIDEO_PROMPT_PREFIX =
  "Use a terrifying battle royale arena for the battle, each fighter starting on opposite sides.";

/** Prompt sent to fal. Omits rationale and ENS update lines. */
export function videoPromptFromTurn(
  turn: NarrationTurn,
  options: { continueFromFrame?: boolean } = {},
): string {
  const body = `${ARENA_VIDEO_PROMPT_PREFIX}\n\n${formatShotList(turn.shots)}`;
  if (options.continueFromFrame !== true) {
    return body;
  }
  // Start image can still show the previous loser; the model must not bring them back.
  return `${body}\n\nContinue from the start image. Any character who died in the previous bout is gone from the arena and must not reappear.`;
}

const FORBIDDEN_ENS_KEYS = ["look", "brief", "icon"] as const;

export function assertEnsLinesLegal(lines: readonly string[]): void {
  for (const line of lines) {
    const pipe = line.indexOf("|");
    if (pipe < 0) {
      throw new FightError(`ENS line missing |separator: ${JSON.stringify(line)}`);
    }
    const body = line.slice(pipe + 1);
    for (const key of FORBIDDEN_ENS_KEYS) {
      if (
        body === key ||
        body.startsWith(`${key}=`) ||
        body.includes(`|${key}=`) ||
        body.includes(`,${key}=`)
      ) {
        throw new FightError(
          `ENS lines must not update ${key}. Got: ${JSON.stringify(line)}`,
        );
      }
    }
  }
}
