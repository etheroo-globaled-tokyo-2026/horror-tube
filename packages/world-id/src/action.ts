function requireId(kind: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`${kind} is required for the World ID action.`);
  }
  return trimmed;
}

/** Waiver gate on the web app: one Orb proof of human to enter the room. */
export function enterRoomAction(): string {
  return "enter-room";
}

export function voteActionForRound(roundId: string): string {
  return `vote-round-${requireId("roundId", roundId)}`;
}

export function stakeActionForBattle(battleId: string): string {
  return `stake-battle-${requireId("battleId", battleId)}`;
}
