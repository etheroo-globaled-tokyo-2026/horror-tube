export type Phase = "waiting" | "pick" | "bet" | "fight" | "settle" | "over";

export type Tape = {
  battleId: string;
  fighters: [string, string];
  winner: string;
  injuries: string[];
  rationale: string;
  videoUrl: string;
  recordedAt: number;
};

export type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null;
  champion: number | null;
  votes: number[];
  voters: number;
  quorum: number;
  bookError: string | null;
  fighters: [number, number] | null;
  selectable: number[];
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
    bet: { side: 0 | 1; units: number; digest: string } | null;
    error: string | null;
  }[];
  chars: { id: number; label: string; alive: boolean; kills: number; damage: number }[];
};
