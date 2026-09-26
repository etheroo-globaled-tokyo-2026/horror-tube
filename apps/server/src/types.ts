/** Shared game-loop contract from docs/game-loop.md. No runtime round is fabricated here. */

export type Phase = "vote" | "countdown" | "bet" | "fight" | "settle" | "over";

export type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null; // ms timestamp; null while vote waits or bet waits for video
  champion: number | null; // character id; null in stage 1
  slots: 1 | 2; // picks per voter this round
  voters: number; // humans who voted (quorum check)
  quorum: number;
  votes: Record<number, number>;
  /**
   * Stage-1 tally as stored in Postgres `tallies`, set before phase becomes bet.
   * Null until that write succeeds. Ranked: most votes, then earliest reachedAt.
   */
  tally: { id: number; votes: number; reachedAt: number }[] | null;
  fighters: [number, number] | null;
  /** Sui pool battle id (UUID). Null outside the bet/fight/settle window. */
  battleId: string | null;
  /** Derived Sui pool object id once the operator opened the pool. */
  poolId: string | null;
  /** Pool totals in USDC base units from the Sui pool (0 before the first read). */
  pool: [number, number];
  winner: 0 | 1 | null; // sent only at settle
  videoUrl: string | null;
  /** ms epoch when a room reported the fight video playing (POST /playback-start). */
  videoStartedAt: number | null;
  /** ms epoch: videoStartedAt + BETTING_CLOSE_AFTER_VIDEO_START_SECONDS. Bets and votes at or after it are rejected. */
  bettingClosesAt: number | null;
  /**
   * CDN URL of the most recent fight's last frame under frames/.
   * Null before the first successful video. Kept across bout transitions so
   * the next image-to-video job can read it after videoUrl is cleared.
   */
  frameUrl: string | null;
  error: string | null; // video failed, bets refunded
  chars: { id: number; alive: boolean; kills: number; damage: number }[];
};
