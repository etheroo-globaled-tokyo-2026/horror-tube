/** What the vote and bet placeholder screens show, derived only from server RoundState. */

export type PlaceholderInput = {
  phase: string;
  champion: number | null;
  votes: Record<number, number>;
  tally: { id: number; votes: number; reachedAt: number }[] | null;
  fighters: [number, number] | null;
  pool: [number, number];
  bettingClosesAt: number | null;
  chars: { id: number; name: string; alive: boolean }[];
};

export type TallyLine = { name: string; votes: number };

export type VoteView = {
  screen: "vote";
  candidates: { id: number; name: string; votes: number }[];
  tally: TallyLine[] | null;
};

export type BetView = {
  screen: "bet";
  sides: [{ name: string; usdc: string }, { name: string; usdc: string }];
  closesAt: string;
  tally: TallyLine[] | null;
};

export const CLOSES_AT_UNSET = "not set: waiting for a room to report playback start";

export function placeholderView(s: PlaceholderInput): VoteView | BetView | null {
  const name = (id: number): string => s.chars[id]?.name ?? `#${String(id)}`;
  const tally =
    s.tally === null ? null : s.tally.map((t) => ({ name: name(t.id), votes: t.votes }));
  if (s.phase === "vote" || s.phase === "countdown") {
    return {
      screen: "vote",
      candidates: s.chars
        .filter((c) => c.alive && c.id !== s.champion)
        .map((c) => ({ id: c.id, name: c.name, votes: s.votes[c.id] ?? 0 })),
      tally,
    };
  }
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
      tally,
    };
  }
  return null;
}
