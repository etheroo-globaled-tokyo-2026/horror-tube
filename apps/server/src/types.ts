/** Shared game-loop contract from docs/game-loop.md. No runtime round is fabricated here. */

export type Phase = "bet" | "fight" | "settle" | "over";

export type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null; // ms timestamp; null while bet waits for video
  champion: number | null; // character id; null during the fresh bout
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
  /** ms epoch: videoStartedAt + BETTING_CLOSE_AFTER_VIDEO_START_SECONDS. Bets at or after it are rejected. */
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
