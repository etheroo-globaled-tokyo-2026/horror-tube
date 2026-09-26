export type Phase = "waiting" | "vote" | "countdown" | "bet" | "fight" | "settle" | "over";

export type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null;
  champion: number | null;
  voters: number;
  quorum: number;
  votes: [number, number];
  tally: [number, number] | null;
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
  bots: {
    address: string;
    pick: number | null;
    bet: { side: 0 | 1; units: number; digest: string } | null;
    error: string | null;
  }[];
  chars: { id: number; label: string; alive: boolean; kills: number; damage: number }[];
};
