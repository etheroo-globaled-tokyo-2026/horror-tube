export type PlaceholderInput = {
  phase: string;
  fighters: [number, number] | null;
  selectable: number[];
  pool: [number, number];
  bettingClosesAt: number | null;
  chars: { id: number; name: string; alive: boolean }[];
};

export type PickView = {
  screen: "pick";
  title: string;
  choices: { id: number; name: string }[];
  act: "book" | "next-fighter";
};

export type BetView = {
  screen: "bet";
  sides: [{ name: string; usdc: string }, { name: string; usdc: string }];
  closesAt: string;
};

export const CLOSES_AT_UNSET = "awaiting the broadcast start";

export function placeholderView(s: PlaceholderInput): PickView | BetView | null {
  const name = (id: number): string => s.chars[id]?.name ?? `#${String(id)}`;
  if ((s.phase === "waiting" || s.phase === "over" || s.phase === "pick") && s.selectable.length > 0) {
    return {
      screen: "pick",
      title: s.phase === "pick" ? "PICK THE NEXT FIGHTER" : "BOOK THE FIRST FIGHTER",
      act: s.phase === "pick" ? "next-fighter" : "book",
      choices: s.selectable.map((id) => ({ id, name: name(id) })),
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
    };
  }
  return null;
}
