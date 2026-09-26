export function formatPoolOdds(
  pool: [number, number],
  side: number,
  feeBps = 0,
): string {
  const a = pool[0];
  const b = pool[1];
  if (
    !(Number.isFinite(a) && a > 0) ||
    !(Number.isFinite(b) && b > 0)
  ) {
    return "no stake";
  }
  const sideStake = pool[side];
  if (!(Number.isFinite(sideStake) && sideStake > 0)) {
    return "no stake";
  }
  if (!(Number.isFinite(feeBps) && feeBps >= 0)) {
    throw new Error(
      `formatPoolOdds feeBps must be a non-negative number. Got ${String(feeBps)}.`,
    );
  }
  const loser = pool[side === 0 ? 1 : 0];
  const fee = (loser * feeBps) / 10_000;
  return ((a + b - fee) / sideStake).toFixed(2);
}
