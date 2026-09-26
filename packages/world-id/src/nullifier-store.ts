export type NullifierStore = {
  has(action: string, nullifier: string): Promise<boolean>;
  claim(action: string, nullifier: string): Promise<void>;
};

export class NullifierAlreadyUsedError extends Error {
  constructor(action: string) {
    super(`World ID nullifier already used for action=${action}. One human acts once per action.`);
    this.name = "NullifierAlreadyUsedError";
  }
}

export class MemoryNullifierStore implements NullifierStore {
  readonly #keys = new Set<string>();

  async has(action: string, nullifier: string): Promise<boolean> {
    return this.#keys.has(keyFor(action, nullifier));
  }

  async claim(action: string, nullifier: string): Promise<void> {
    const key = keyFor(action, nullifier);
    if (this.#keys.has(key)) {
      throw new NullifierAlreadyUsedError(action);
    }
    this.#keys.add(key);
  }
}

function keyFor(action: string, nullifier: string): string {
  if (action.trim() === "") {
    throw new Error("action is required to store a World ID nullifier.");
  }
  if (!/^[0-9]+$/u.test(nullifier)) {
    throw new Error("nullifier must be a base-10 string to store it.");
  }
  return `${action}\0${nullifier}`;
}
