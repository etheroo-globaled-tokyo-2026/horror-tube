export function typedFighterId(buf: string, selectable: readonly number[]): number | null {
  if (!/^\d{2}$/.test(buf)) return null;
  const id = Number(buf) - 1;
  return selectable.includes(id) ? id : null;
}
