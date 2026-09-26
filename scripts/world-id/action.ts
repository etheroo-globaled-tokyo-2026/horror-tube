export function stakeActionForBattle(battleId: string): string {
  const trimmed = battleId.trim();
  if (trimmed === "") {
    throw new Error(
      "battleId is required for the World ID stake action. Refusing to invent a battle id.",
    );
  }
  return `stake-battle-${trimmed}`;
}
