import { FightError } from "./env.js";
import type { FightInput, LivingCard, Shot } from "./types.js";

/** The shot list the rotoscope service reads: who to find in each span of the clip. */
export type RotoscopeShotList = {
  shots: {
    start_s: number;
    end_s: number;
    cast: { id: "A" | "B"; name: string; find: string }[];
    /** Always empty: the rotoscope then draws only the fighters and blood. */
    props: [];
  }[];
};

const TIME_RANGE = /^(\d+(?:\.\d+)?)\s*s?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*s?$/u;

/** Seconds from a narrated time_range such as "0-4s" or "4.5–8 s". */
export function parseTimeRange(timeRange: string): {
  start_s: number;
  end_s: number;
} {
  const match = TIME_RANGE.exec(timeRange.trim());
  if (match === null) {
    throw new FightError(
      `shot time_range ${JSON.stringify(timeRange)} is not seconds as "<start>-<end>s", e.g. "0-4s". The rotoscope needs each shot's time span.`,
    );
  }
  const start_s = Number(match[1]);
  const end_s = Number(match[2]);
  if (end_s <= start_s) {
    throw new FightError(`shot time_range ${JSON.stringify(timeRange)} ends before it starts.`);
  }
  return { start_s, end_s };
}

/** What the rotoscope searches each fighter's video for, keyed by card subname. */
// Measured with SAM 3.1 on fal clips; a fighter's name alone mostly scores 0.
export const SEARCH_PHRASES: ReadonlyMap<string, string> = new Map([
  ["chucky", "doll with red hair"],
  ["count", "man with a cape"],
  ["frankenstein", "man with green skin"],
  ["freddy", "man in a striped sweater"],
  ["godzilla", "giant reptile monster"],
  ["imhotep", "man wrapped in bandages"],
  ["jason", "man in a hockey mask"],
  ["leatherface", "man in an apron"],
  ["pinhead", "man in a black leather coat"],
  ["wolf", "werewolf"],
]);

/** Each narrated shot's time span, with both fighters and the phrase each is found by. */
export function buildShotList(shots: readonly Shot[], input: FightInput): RotoscopeShotList {
  const cast = [
    { id: "A" as const, ...found(input.fighterA) },
    { id: "B" as const, ...found(input.fighterB) },
  ];
  return {
    shots: shots.map((shot) => ({
      ...parseTimeRange(shot.time_range),
      cast,
      props: [],
    })),
  };
}

function found(card: LivingCard): { name: string; find: string } {
  const find = SEARCH_PHRASES.get(card.subname);
  if (find === undefined) {
    throw new FightError(
      `no rotoscope search phrase for fighter ${JSON.stringify(card.subname)}. Add one to SEARCH_PHRASES in packages/fight/src/shot-list.ts.`,
    );
  }
  const display = card.display_name?.trim();
  const name = display === undefined || display === "" ? card.subname : display;
  return { name, find };
}
