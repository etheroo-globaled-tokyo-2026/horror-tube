import type { FightInput, NarrationTurn } from "../src/types.js";

export const fighterA = {
  subname: "freddy",
  display_name: "Freddy Krueger",
  look: "Burned man in a striped sweater and bladed glove.",
  brief: "Dream demon who kills in sleep.",
  injuries: [] as string[],
  status: "alive" as const,
};

export const fighterB = {
  subname: "jason",
  display_name: "Jason Voorhees",
  look: "Huge figure in a hockey mask with a machete.",
  brief: "Camp killer who never stops walking.",
  injuries: ["cracked mask"] as string[],
  status: "alive" as const,
};

export const livingOpponent = {
  subname: "leatherface",
  display_name: "Leatherface",
  look: "Giant in a skin mask swinging a chainsaw.",
  brief: "Cannibal family enforcer.",
  injuries: [] as string[],
  status: "alive" as const,
};

export const otherLiving = {
  subname: "chucky",
  display_name: "Chucky",
  look: "Scarred doll in overalls with a kitchen knife.",
  brief: "Possessed doll who talks while he stabs.",
  injuries: [] as string[],
  status: "alive" as const,
};

export function sampleFightInput(): FightInput {
  return {
    fighterA: { ...fighterA },
    fighterB: { ...fighterB, injuries: [...fighterB.injuries] },
    eligibleOpponents: [
      { ...livingOpponent },
      { ...otherLiving },
    ],
  };
}

export function validTurn(overrides: Partial<NarrationTurn> = {}): NarrationTurn {
  const shotList = [
    {
      time_range: "0-4s",
      characters:
        "Burned man in a striped sweater and bladed glove. Huge figure in a hockey mask with a machete, cracked mask already showing.",
      action:
        "Jason drives the machete through Freddy's chest while Freddy's glove scrapes a deep gouge across Jason's shoulder.",
      camera: "Low tracking push-in as the machete lands.",
      style: "Gritty practical-horror, wet blood, no readable text, no extra people.",
    },
    {
      time_range: "4-8s",
      characters:
        "Burned man collapsing. Huge figure in a hockey mask, cracked mask, fresh gouge across the shoulder.",
      action:
        "Freddy drops dead. Jason stands over him with the shoulder gouge bleeding through the jacket.",
      camera: "Slow orbit ending on Jason alone.",
      style: "Muted night palette, rain mist, no readable text.",
    },
  ];
  return {
    shots: shotList,
    loser_subname: "freddy",
    winner_subname: "jason",
    winner_injuries: ["cracked mask", "gouge across the shoulder"],
    rationale: "Jason's size and machete overpower Freddy in open ground.",
    next_opponent_subname: "leatherface",
    ...overrides,
  };
}
