import { FightError } from "./env.js";
import type { FightInput, NarrationModelTurn, Shot } from "./types.js";
import { formatShotList } from "./render.js";

export function validateFightInput(input: FightInput): void {
  for (const [label, card] of [
    ["fighterA", input.fighterA],
    ["fighterB", input.fighterB],
  ] as const) {
    if (card.status !== "alive") {
      throw new FightError(
        `${label} must have status=alive. Got: ${JSON.stringify(card.status)}`,
      );
    }
    if (card.subname.trim() === "") {
      throw new FightError(`${label}.subname is required.`);
    }
  }
  if (input.fighterA.subname === input.fighterB.subname) {
    throw new FightError(
      `fighterA and fighterB must be different subnames. Got: ${input.fighterA.subname}`,
    );
  }
  for (const opp of input.eligibleOpponents) {
    if (opp.status !== "alive") {
      throw new FightError(
        `eligible opponent ${opp.subname} must have status=alive. Got: ${JSON.stringify(opp.status)}`,
      );
    }
  }
}

export function validateNarrationTurn(
  turn: NarrationModelTurn,
  input: FightInput,
): void {
  validateFightInput(input);
  const fighters = new Set([
    input.fighterA.subname,
    input.fighterB.subname,
  ]);
  if (turn.loser_subname === turn.winner_subname) {
    throw new FightError(
      `both die is rejected: loser and winner are the same subname (${turn.loser_subname}).`,
    );
  }
  if (!fighters.has(turn.loser_subname)) {
    throw new FightError(
      `neither dies is rejected: loser_subname ${JSON.stringify(turn.loser_subname)} is not one of the two fighters.`,
    );
  }
  if (!fighters.has(turn.winner_subname)) {
    throw new FightError(
      `winner_subname ${JSON.stringify(turn.winner_subname)} is not one of the two fighters.`,
    );
  }
  if (!Array.isArray(turn.shots) || turn.shots.length === 0) {
    throw new FightError("shots must be a non-empty array.");
  }
  for (const shot of turn.shots) {
    assertShot(shot);
  }
  const shotText = formatShotList(turn.shots);
  if (!Array.isArray(turn.winner_injuries)) {
    throw new FightError("winner_injuries must be a JSON array of strings.");
  }
  for (const injury of turn.winner_injuries) {
    if (injury.trim() === "") {
      throw new FightError(
        `winner_injuries items must be non-empty strings. Got: ${JSON.stringify(injury)}`,
      );
    }
    if (!shotText.includes(injury)) {
      throw new FightError(
        `injury phrase missing from the shot list: ${JSON.stringify(injury)}`,
      );
    }
  }
  if (turn.rationale.trim() === "") {
    throw new FightError("rationale must be a non-empty string.");
  }
}

function assertShot(shot: Shot): void {
  for (const key of [
    "time_range",
    "characters",
    "action",
    "camera",
    "style",
  ] as const) {
    if (shot[key].trim() === "") {
      throw new FightError(`shot.${key} must be a non-empty string.`);
    }
  }
}
