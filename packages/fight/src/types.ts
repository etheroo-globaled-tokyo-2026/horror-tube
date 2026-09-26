/** Living roster card fields used as fight narration input. */
export type LivingCard = {
  subname: string;
  display_name?: string;
  look: string;
  brief: string;
  injuries: string[];
  status: "alive";
};

export type FightInput = {
  fighterA: LivingCard;
  fighterB: LivingCard;
  /** Living opponents the model may name next. Must not include the eventual winner. */
  eligibleOpponents: LivingCard[];
};

export type Shot = {
  /** Timed beat, e.g. "0-4s". */
  time_range: string;
  /** Visible character looks present in the shot. */
  characters: string;
  action: string;
  camera: string;
  style: string;
};

export type NarrationTurn = {
  shots: Shot[];
  loser_subname: string;
  winner_subname: string;
  winner_injuries: string[];
  rationale: string;
  next_opponent_subname: string;
};

export type FightTurnResult = {
  turn: NarrationTurn;
  ensLines: [string, string];
  nextOpponentSubname: string;
  rationale: string;
  videoPrompt: string;
  videoUrl: string;
  expandedPrompt: string | null;
};
