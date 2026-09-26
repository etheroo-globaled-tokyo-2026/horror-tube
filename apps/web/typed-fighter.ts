// WARNING: one remote key per room caps the roster at ten residents.
export const roomNumber = (id: number): string => String((id + 1) % 10);

export function typedRoomId(buf: string): number | null {
  return /^\d$/.test(buf) ? (Number(buf) + 9) % 10 : null;
}

export function typedStake(buf: string): number | null {
  if (!/^\d{1,6}$/.test(buf)) return null;
  const amount = Number(buf);
  return amount > 0 ? amount : null;
}

export function typedFighterId(buf: string, selectable: readonly number[]): number | null {
  const id = typedRoomId(buf);
  return id !== null && selectable.includes(id) ? id : null;
}
