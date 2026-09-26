import {
  loadNarrationConfig,
  pickPairing,
  type LivingCard,
  type PairingConfig,
  type PairingResult,
} from "@horror-tube/fight";

import type { LoadLivingCards } from "./fight-job.js";

export type PairingRequest = {
  championSubname: string | null;
  candidateSubnames: string[];
  round: number;
  opening: boolean;
};

export type { PairingResult };

export type PairingRunner = (request: PairingRequest) => Promise<PairingResult>;

export function createPairingRunner(deps: {
  loadLivingCards: LoadLivingCards;
  pairing: PairingConfig;
  pick?: typeof pickPairing;
  env?: NodeJS.ProcessEnv;
}): PairingRunner {
  const pick = deps.pick ?? pickPairing;
  const env = deps.env ?? process.env;
  return async (request) => {
    const wanted = [
      ...(request.championSubname === null ? [] : [request.championSubname]),
      ...request.candidateSubnames,
    ];
    const cards = new Map((await deps.loadLivingCards(wanted)).map((card) => [card.subname, card]));
    const card = (subname: string): LivingCard => {
      const found = cards.get(subname);
      if (found === undefined) {
        throw new Error(`Pairing is missing the ENS card for ${JSON.stringify(subname)}.`);
      }
      return found;
    };
    return pick(
      {
        champion: request.championSubname === null ? null : card(request.championSubname),
        candidates: request.candidateSubnames.map(card),
        opening: request.opening,
      },
      loadNarrationConfig(env),
      deps.pairing,
    );
  };
}
