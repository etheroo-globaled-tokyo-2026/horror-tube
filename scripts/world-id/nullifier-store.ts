export type NullifierClaim = {
  battleId: string;
  nullifier: string;
};

export type NullifierStore = {
  has(battleId: string, nullifier: string): boolean;
  claim(battleId: string, nullifier: string): void;
};

export class MemoryNullifierStore implements NullifierStore {
  readonly #keys = new Set<string>();

  has(battleId: string, nullifier: string): boolean {
    return this.#keys.has(keyFor(battleId, nullifier));
  }

  claim(battleId: string, nullifier: string): void {
    const key = keyFor(battleId, nullifier);
    if (this.#keys.has(key)) {
      throw new Error(
        `Nullifier already used for battle_id=${battleId}. One human may stake once per battle.`,
      );
    }
    this.#keys.add(key);
  }
}

function keyFor(battleId: string, nullifier: string): string {
  const battle = battleId.trim();
  const nullifierValue = nullifier.trim();
  if (battle === "") {
    throw new Error("battleId is required to store a stake nullifier.");
  }
  if (nullifierValue === "") {
    throw new Error("nullifier is required to store a stake nullifier.");
  }
  return `${battle}\0${nullifierValue}`;
}
