/** Whole USDC typed on the remote. Empty, zero, and a too-long string are not a stake. */
export function typedStake(buf: string): number | null {
  if (!/^\d{1,6}$/.test(buf)) return null;
  const amount = Number(buf);
  return amount > 0 ? amount : null;
}

/** Two remote digits, 1-based, and only an id the server marked selectable. */
export function typedFighterId(buf: string, selectable: readonly number[]): number | null {
  if (!/^\d{2}$/.test(buf)) return null;
  const id = Number(buf) - 1;
  return selectable.includes(id) ? id : null;
}
