/** Shared game-loop contract from docs/game-loop.md. No runtime round is fabricated here. */

export type Phase = "vote" | "countdown" | "bet" | "fight" | "settle" | "over";

export const VIDEO_STYLES = ["rotoscope", "film"] as const;
export type VideoStyle = (typeof VIDEO_STYLES)[number];

export type RoundState = {
  round: number;
  phase: Phase;
  endsAt: number | null; // ms timestamp; null while vote waits or bet waits for video
  champion: number | null; // character id; null in stage 1
  slots: 1 | 2; // picks per voter this round
  voters: number; // humans who voted (quorum check)
  quorum: number;
  votes: Record<number, number>;
  fighters: [number, number] | null;
  pool: [number, number];
  winner: 0 | 1 | null; // sent only at settle
  videoUrl: string | null;
  videoStyle: VideoStyle | null;
  /**
   * CDN URL of the most recent fight's last frame under frames/.
   * Null before the first successful video. Kept across bout transitions so
   * the next image-to-video job can read it after videoUrl is cleared.
   */
  frameUrl: string | null;
  error: string | null; // video failed, bets refunded
  chars: { id: number; alive: boolean; kills: number; damage: number }[];
};
