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
  /** Living opponents still on the roster outside this bout. Used after the fight to pick a random next challenger; the model does not choose them. */
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

/** Structured model output. Next opponent is set by rotation after the fight. */
export type NarrationModelTurn = Omit<NarrationTurn, "next_opponent_subname">;

export type FightTurnResult = {
  turn: NarrationTurn;
  ensLines: [string, string];
  nextOpponentSubname: string;
  rationale: string;
  videoPrompt: string;
  /** Durable Spaces CDN URL after upload. Never the expiring fal generator URL. */
  videoUrl: string;
  expandedPrompt: string | null;
};
