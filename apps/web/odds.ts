/** Odds label for the bet TV. Both sides need stake before division is meaningful. */
export function formatPoolOdds(pool: [number, number], side: number): string {
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
  return ((a + b) / sideStake).toFixed(2);
}
