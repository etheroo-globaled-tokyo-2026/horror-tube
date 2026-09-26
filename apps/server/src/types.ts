export type Phase = "vote" | "countdown" | "bet" | "fight" | "settle" | "over";

export type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null;
  champion: number | null;
  slots: 1 | 2;
  voters: number;
  quorum: number;
  votes: Record<number, number>;
  tally: { id: number; votes: number; reachedAt: number }[] | null;
  fighters: [number, number] | null;
  battleId: string | null;
  poolId: string | null;
  pool: [number, number];
  winner: 0 | 1 | null;
  videoUrl: string | null;
  videoStartedAt: number | null;
  bettingClosesAt: number | null;
  frameUrl: string | null;
  error: string | null;
  chars: { id: number; alive: boolean; kills: number; damage: number }[];
};
