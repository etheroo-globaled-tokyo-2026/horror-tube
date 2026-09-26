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

/** Each narrated shot's time span, with both fighters found by their card name. */
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

// The segmenter finds horror characters by their names, so the name is also the search phrase.
function found(card: LivingCard): { name: string; find: string } {
  const display = card.display_name?.trim();
  const name = display === undefined || display === "" ? card.subname : display;
  return { name, find: name };
}
