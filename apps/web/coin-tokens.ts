export const COINS = [1, 5, 10] as const;

export type Coin = (typeof COINS)[number];

const LARGEST_FIRST = [...COINS].sort((a, b) => b - a);

export const coinTotal = (coins: readonly Coin[]): number => coins.reduce((sum, c) => sum + c, 0);

export function tokensFor(dollars: number, max: number): Coin[] {
  const out: Coin[] = [];
  let left = dollars;
  for (const coin of LARGEST_FIRST)
    while (left >= coin && out.length < max) {
      out.push(coin);
      left -= coin;
    }
  return out;
}
