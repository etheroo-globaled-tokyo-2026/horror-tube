import { randomInt as nodeCryptoRandomInt } from "node:crypto";

export type RandomInt = (maxExclusive: number) => number;

export function cryptoRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(
      `cryptoRandomInt maxExclusive must be a positive integer. Got: ${maxExclusive}`,
    );
  }
  return nodeCryptoRandomInt(0, maxExclusive);
}
