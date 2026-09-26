export type PlaceholderInput = {
  phase: string;
  fighters: [number, number] | null;
  pool: [number, number];
  bettingClosesAt: number | null;
  chars: { id: number; name: string; alive: boolean }[];
};

export type BetView = {
  screen: "bet";
  sides: [{ name: string; usdc: string }, { name: string; usdc: string }];
  closesAt: string;
};

export const CLOSES_AT_UNSET = "not set: waiting for a room to report playback start";

export function placeholderView(s: PlaceholderInput): BetView | null {
  const name = (id: number): string => s.chars[id]?.name ?? `#${String(id)}`;
  if (s.phase === "bet" && s.fighters !== null) {
    const [a, b] = s.fighters;
    return {
      screen: "bet",
      sides: [
        { name: name(a), usdc: (s.pool[0] / 1_000_000).toFixed(2) },
        { name: name(b), usdc: (s.pool[1] / 1_000_000).toFixed(2) },
      ],
      closesAt:
        s.bettingClosesAt === null ? CLOSES_AT_UNSET : new Date(s.bettingClosesAt).toISOString(),
    };
  }
  return null;
}
