import type { FightInput, LivingCard, Shot } from "./types.js";

export type { Shot };

/**
 * Queued fight result while betting is open. ENS writes and the Sui pool
 * settle run only after both gates are set — never from a timer.
 */
export type BattleQueueRecord = {
  id: string;
  /** Sui pool battle id (UUID string). */
  battleId: string;
  fighterASubname: string;
  fighterBSubname: string;
  shots: Shot[];
  /** Loser line first, winner line last (narration contract). */
  ensLines: [string, string];
  rationale: string;
  winnerSubname: string;
  loserSubname: string;
  winnerInjuries: string[];
  /** Challenger for the following bout; set by rotation, not the model. */
  nextOpponentSubname: string;
  bettingClosed: boolean;
  playbackFinished: boolean;
  /** ms epoch when a room reported the fight video playing; null until then. */
  videoStartedAt: number | null;
  /** ms epoch: videoStartedAt + BETTING_CLOSE_AFTER_VIDEO_START_SECONDS. */
  bettingClosesAt: number | null;
  injuriesTxHash: string | null;
  statusTxHash: string | null;
  settlementTxHash: string | null;
};

export type BattleQueueInsert = Omit<
  BattleQueueRecord,
  | "bettingClosed"
  | "playbackFinished"
  | "videoStartedAt"
  | "bettingClosesAt"
  | "injuriesTxHash"
  | "statusTxHash"
  | "settlementTxHash"
>;

export type SettleStep =
  | "queued"
  | "injuries"
  | "status"
  | "settlement"
  | "next_bout"
  | "done";

export type ChainWritePorts = {
  /**
   * Read current on-chain injuries text, then write the winner's injuries.
   * Must refuse "" or non-array encodings (#55) before sending a tx.
   */
  writeWinnerInjuries: (args: {
    subname: string;
    injuries: string[];
    ensLine: string;
  }) => Promise<string>;
  writeLoserStatusDead: (args: {
    subname: string;
    ensLine: string;
  }) => Promise<string>;
  /**
   * Settle the Sui pool for this battle with the winning side (0 = fighter A,
   * 1 = fighter B). Called after the loser ENS status is dead.
   */
  settleBattle: (battleId: string, winningSide: 0 | 1) => Promise<string>;
};

export type BattleQueueStore = {
  get(id: string): Promise<BattleQueueRecord | null>;
  save(record: BattleQueueRecord): Promise<void>;
};

export class BattleQueueError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BattleQueueError";
  }
}

/** New row: queued, no chain writes yet. Zero bets is fine; gates stay false. */
export function createQueuedRecord(insert: BattleQueueInsert): BattleQueueRecord {
  assertInsert(insert);
  return {
    ...insert,
    bettingClosed: false,
    playbackFinished: false,
    videoStartedAt: null,
    bettingClosesAt: null,
    injuriesTxHash: null,
    statusTxHash: null,
    settlementTxHash: null,
  };
}

export function markBettingClosed(record: BattleQueueRecord): BattleQueueRecord {
  return { ...record, bettingClosed: true };
}

export function markPlaybackFinished(
  record: BattleQueueRecord,
): BattleQueueRecord {
  return { ...record, playbackFinished: true };
}

/**
 * Both signals are required. A timer, guessed delay, or early write is a failure.
 */
export function assertSettleGates(record: BattleQueueRecord): void {
  if (!record.bettingClosed) {
    throw new BattleQueueError(
      "settle aborted: betting-closed signal is missing. Do not infer it from a timer.",
    );
  }
  if (!record.playbackFinished) {
    throw new BattleQueueError(
      "settle aborted: playback-finished signal is missing. Do not infer it from a timer.",
    );
  }
}

/**
 * First incomplete chain step. Confirmed tx hashes are never repeated.
 */
export function nextSettleStep(record: BattleQueueRecord): SettleStep {
  if (record.injuriesTxHash === null) return "injuries";
  if (record.statusTxHash === null) return "status";
  if (record.settlementTxHash === null) return "settlement";
  return "next_bout";
}

/**
 * Parse an on-chain injuries text record. "" or non-array encodings fail;
 * do not coerce (#55).
 */
export function parseInjuriesTextRecord(raw: string): string[] {
  if (raw === "") {
    throw new BattleQueueError(
      'injuries text record is "". Refusing to coerce; expected a JSON array (see #55).',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new BattleQueueError(
      `injuries text record is not JSON. Got: ${JSON.stringify(raw)}`,
      { cause },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new BattleQueueError(
      `injuries text record must be a JSON array. Got: ${JSON.stringify(raw)}`,
    );
  }
  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new BattleQueueError(
        `injuries array items must be strings. Got: ${JSON.stringify(raw)}`,
      );
    }
  }
  return parsed as string[];
}

/**
 * Apply injuries → status=dead → settleBattle in that order.
 * Resumes at the first step without a confirmed tx hash.
 * Does not start the next bout; caller uses fightInputFromQueuedNext after done.
 */
export async function settleQueuedBattle(
  record: BattleQueueRecord,
  ports: ChainWritePorts,
  store: BattleQueueStore,
): Promise<BattleQueueRecord> {
  assertSettleGates(record);
  let current = { ...record };

  if (current.injuriesTxHash === null) {
    try {
      const hash = await ports.writeWinnerInjuries({
        subname: current.winnerSubname,
        injuries: current.winnerInjuries,
        ensLine: current.ensLines[1],
      });
      assertTxHash(hash, "injuries");
      current = { ...current, injuriesTxHash: hash };
      await store.save(current);
    } catch (cause) {
      throw wrapStepError("injuries", current, cause);
    }
  }

  if (current.statusTxHash === null) {
    try {
      const hash = await ports.writeLoserStatusDead({
        subname: current.loserSubname,
        ensLine: current.ensLines[0],
      });
      assertTxHash(hash, "status");
      current = { ...current, statusTxHash: hash };
      await store.save(current);
    } catch (cause) {
      throw wrapStepError("status", current, cause);
    }
  }

  if (current.settlementTxHash === null) {
    try {
      const winningSide: 0 | 1 =
        current.winnerSubname === current.fighterASubname
          ? 0
          : current.winnerSubname === current.fighterBSubname
            ? 1
            : (() => {
                throw new BattleQueueError(
                  `settleBattle: winner ${JSON.stringify(current.winnerSubname)} is neither fighterA ${JSON.stringify(current.fighterASubname)} nor fighterB ${JSON.stringify(current.fighterBSubname)}.`,
                );
              })();
      const hash = await ports.settleBattle(current.battleId, winningSide);
      assertTxHash(hash, "settlement");
      current = { ...current, settlementTxHash: hash };
      await store.save(current);
    } catch (cause) {
      throw wrapStepError("settlement", current, cause);
    }
  }

  return current;
}

/**
 * Following bout: winner stays vs the stored next opponent (rotation result).
 * Does not re-roll. Winner and opponent must be alive and distinct.
 */
export function fightInputFromQueuedNext(
  livingCards: readonly LivingCard[],
  winnerSubname: string,
  nextOpponentSubname: string,
): FightInput {
  if (winnerSubname.trim() === "") {
    throw new BattleQueueError(
      "fightInputFromQueuedNext: winnerSubname is required.",
    );
  }
  if (nextOpponentSubname.trim() === "") {
    throw new BattleQueueError(
      "fightInputFromQueuedNext: nextOpponentSubname is required.",
    );
  }
  if (winnerSubname === nextOpponentSubname) {
    throw new BattleQueueError(
      `fightInputFromQueuedNext: next opponent must not be the winner (${JSON.stringify(winnerSubname)}).`,
    );
  }
  const champion = livingCards.find((c) => c.subname === winnerSubname);
  const challenger = livingCards.find(
    (c) => c.subname === nextOpponentSubname,
  );
  if (champion === undefined) {
    throw new BattleQueueError(
      `fightInputFromQueuedNext: winner ${JSON.stringify(winnerSubname)} is missing or not alive on the roster.`,
    );
  }
  if (challenger === undefined) {
    throw new BattleQueueError(
      `fightInputFromQueuedNext: next opponent ${JSON.stringify(nextOpponentSubname)} is missing or not alive on the roster.`,
    );
  }
  if (champion.status !== "alive") {
    throw new BattleQueueError(
      `fightInputFromQueuedNext: winner ${JSON.stringify(winnerSubname)} must be alive.`,
    );
  }
  if (challenger.status !== "alive") {
    throw new BattleQueueError(
      `fightInputFromQueuedNext: next opponent ${JSON.stringify(nextOpponentSubname)} must be alive.`,
    );
  }
  const eligibleOpponents = livingCards.filter(
    (c) =>
      c.subname !== champion.subname && c.subname !== challenger.subname,
  );
  return {
    fighterA: champion,
    fighterB: challenger,
    eligibleOpponents,
  };
}

function assertInsert(insert: BattleQueueInsert): void {
  if (insert.id.trim() === "") {
    throw new BattleQueueError("battle queue id is required.");
  }
  if (insert.battleId.trim() === "") {
    throw new BattleQueueError("battleId is required.");
  }
  if (insert.fighterASubname.trim() === "" || insert.fighterBSubname.trim() === "") {
    throw new BattleQueueError("both fighter subnames are required.");
  }
  if (!Array.isArray(insert.shots) || insert.shots.length === 0) {
    throw new BattleQueueError("shots must be a non-empty array.");
  }
  if (insert.ensLines.length !== 2) {
    throw new BattleQueueError("ensLines must be [loser, winner].");
  }
  if (insert.rationale.trim() === "") {
    throw new BattleQueueError("rationale is required.");
  }
  if (insert.winnerSubname.trim() === "" || insert.loserSubname.trim() === "") {
    throw new BattleQueueError("winnerSubname and loserSubname are required.");
  }
  if (!Array.isArray(insert.winnerInjuries)) {
    throw new BattleQueueError("winnerInjuries must be an array.");
  }
  if (insert.nextOpponentSubname.trim() === "") {
    throw new BattleQueueError("nextOpponentSubname is required.");
  }
}

function assertTxHash(hash: string, step: string): void {
  if (typeof hash !== "string" || hash.trim() === "") {
    throw new BattleQueueError(
      `${step} write returned an empty transaction hash.`,
    );
  }
}

function wrapStepError(
  step: string,
  record: BattleQueueRecord,
  cause: unknown,
): BattleQueueError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new BattleQueueError(
    `battle queue ${record.id} settle step ${step} failed (battleId=${record.battleId}). ${detail}`,
    { cause },
  );
}

/** In-memory store for unit tests. Not a second database. */
export class MemoryBattleQueueStore implements BattleQueueStore {
  private readonly rows = new Map<string, BattleQueueRecord>();

  async get(id: string): Promise<BattleQueueRecord | null> {
    const row = this.rows.get(id);
    return row === undefined ? null : structuredClone(row);
  }

  async save(record: BattleQueueRecord): Promise<void> {
    this.rows.set(record.id, structuredClone(record));
  }
}
