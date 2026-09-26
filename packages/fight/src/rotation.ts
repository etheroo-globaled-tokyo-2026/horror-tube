import { randomInt as nodeCryptoRandomInt } from "node:crypto";

export type RosterEntry = {
  subname: string;
  status: "alive" | "dead";
};

export type RotationPair = {
  championSubname: string;
  challengerSubname: string;
};

export type RandomInt = (maxExclusive: number) => number;

export function cryptoRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(
      `cryptoRandomInt maxExclusive must be a positive integer. Got: ${maxExclusive}`,
    );
  }
  return nodeCryptoRandomInt(0, maxExclusive);
}

export function nextRotationPair(
  roster: readonly RosterEntry[],
  winnerSubname: string,
  randomInt: RandomInt,
): RotationPair {
  if (roster.length === 0) {
    throw new Error(
      "nextRotationPair requires a non-empty roster. Got 0 entries.",
    );
  }

  const winnerIndex = roster.findIndex(
    (entry) => entry.subname === winnerSubname,
  );
  if (winnerIndex < 0) {
    throw new Error(
      `nextRotationPair: winner ${JSON.stringify(winnerSubname)} is missing from the roster.`,
    );
  }
  const winner = roster[winnerIndex]!;
  if (winner.status !== "alive") {
    throw new Error(
      `nextRotationPair: winner ${JSON.stringify(winnerSubname)} must be alive. Got status=${JSON.stringify(winner.status)}.`,
    );
  }

  const living = roster.filter((entry) => entry.status === "alive");
  if (living.length < 2) {
    const only = living.length === 1 ? living[0]!.subname : "(none)";
    throw new Error(
      `nextRotationPair: no fight when fewer than 2 living characters remain (living=${living.length}, only=${only}).`,
    );
  }

  const challengers = living.filter(
    (entry) => entry.subname !== winnerSubname,
  );
  if (challengers.length === 0) {
    throw new Error(
      `nextRotationPair: no living challenger remains for winner ${JSON.stringify(winnerSubname)}.`,
    );
  }

  const index = randomInt(challengers.length);
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= challengers.length
  ) {
    throw new Error(
      `nextRotationPair: randomInt(${challengers.length}) must return an integer in [0, ${challengers.length}). Got: ${JSON.stringify(index)}`,
    );
  }

  return {
    championSubname: winnerSubname,
    challengerSubname: challengers[index]!.subname,
  };
}

export function rosterAfterFight(
  fighters: readonly { subname: string }[],
  otherLiving: readonly { subname: string }[],
  loserSubname: string,
  winnerSubname: string,
): RosterEntry[] {
  const seen = new Set<string>();
  const entries: RosterEntry[] = [];
  for (const fighter of fighters) {
    if (seen.has(fighter.subname)) {
      throw new Error(
        `rosterAfterFight: duplicate subname ${JSON.stringify(fighter.subname)}.`,
      );
    }
    seen.add(fighter.subname);
    let status: "alive" | "dead";
    if (fighter.subname === loserSubname) {
      status = "dead";
    } else if (fighter.subname === winnerSubname) {
      status = "alive";
    } else {
      throw new Error(
        `rosterAfterFight: fighter ${JSON.stringify(fighter.subname)} is neither loser ${JSON.stringify(loserSubname)} nor winner ${JSON.stringify(winnerSubname)}.`,
      );
    }
    entries.push({ subname: fighter.subname, status });
  }
  for (const other of otherLiving) {
    if (seen.has(other.subname)) {
      throw new Error(
        `rosterAfterFight: other living ${JSON.stringify(other.subname)} duplicates a fighter.`,
      );
    }
    seen.add(other.subname);
    entries.push({ subname: other.subname, status: "alive" });
  }
  return entries;
}
