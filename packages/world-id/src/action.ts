function requireId(kind: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`${kind} is required for the World ID action.`);
  }
  return trimmed;
}

export function enterRoomAction(): string {
  return "enter-room";
}

export function stakeActionForBattle(battleId: string): string {
  return `stake-battle-${requireId("battleId", battleId)}`;
}
