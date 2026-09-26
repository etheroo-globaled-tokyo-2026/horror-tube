/** Minimal roster row for winner-stays rotation. Order is roster order. */
export type RosterEntry = {
  subname: string;
  status: "alive" | "dead";
};

export type RotationPair = {
  /** Previous fight winner; stays on. */
  championSubname: string;
  /** Next living roster character after the champion, wrapping. */
  challengerSubname: string;
};

/**
 * Next video-continuity pair: previous winner plus the next living roster
 * character after that winner (wrap; skip dead; never the champion).
 * Not the voter challenger ballot.
 */
export function nextRotationPair(
  roster: readonly RosterEntry[],
  winnerSubname: string,
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

  for (let offset = 1; offset <= roster.length; offset++) {
    const entry = roster[(winnerIndex + offset) % roster.length]!;
    if (entry.status === "alive" && entry.subname !== winnerSubname) {
      return {
        championSubname: winnerSubname,
        challengerSubname: entry.subname,
      };
    }
  }

  throw new Error(
    `nextRotationPair: no living challenger found for winner ${JSON.stringify(winnerSubname)} after scanning the roster.`,
  );
}
