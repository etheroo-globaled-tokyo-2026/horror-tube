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

/** Prompt sent to fal. Omits rationale and ENS update lines. */
export function videoPromptFromTurn(turn: NarrationTurn): string {
  return formatShotList(turn.shots);
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
