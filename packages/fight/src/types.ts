import { z } from "zod";

const nonEmptyString = z
  .string({ error: "must be a non-empty string" })
  .regex(/\S/);

export const livingCardSchema = z.object(
  {
    subname: nonEmptyString,
    display_name: nonEmptyString.optional(),
    look: nonEmptyString,
    brief: nonEmptyString,
    injuries: z.array(nonEmptyString, {
      error: "must be a JSON array of strings",
    }),
    status: z.literal("alive", { error: 'must be "alive"' }),
  },
  { error: "must be a JSON object" },
);

export type LivingCard = z.infer<typeof livingCardSchema>;

export type FightInput = {
  fighterA: LivingCard;
  fighterB: LivingCard;
  eligibleOpponents: LivingCard[];
};

export const shotSchema = z.object({
  time_range: z.string(),
  characters: z.string(),
  action: z.string(),
  camera: z.string(),
  style: z.string(),
});

export type Shot = z.infer<typeof shotSchema>;

export const narrationModelTurnSchema = z.object({
  shots: z.array(shotSchema),
  loser_subname: z.string(),
  winner_subname: z.string(),
  winner_injuries: z.array(z.string()),
  rationale: z.string(),
});

export type NarrationModelTurn = z.infer<typeof narrationModelTurnSchema>;

export type NarrationTurn = NarrationModelTurn & {
  next_opponent_subname: string;
};

export type FightTurnResult = {
  turn: NarrationTurn;
  ensLines: [string, string];
  nextOpponentSubname: string;
  rationale: string;
  videoPrompt: string;
  videoUrl: string;
  frameUrl: string;
  expandedPrompt: string | null;
};
