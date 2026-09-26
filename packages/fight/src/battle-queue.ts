import { z } from "zod";

import type { Shot } from "./types.js";

export type { Shot };

export type BattleQueueRecord = {
  id: string;
  battleId: string;
  fighterASubname: string;
  fighterBSubname: string;
  shots: Shot[];
  ensLines: [loser: string, winner: string];
  rationale: string;
  winnerSubname: string;
  loserSubname: string;
  winnerInjuries: string[];
  bettingClosed: boolean;
  playbackFinished: boolean;
  videoStartedAt: number | null;
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

export type SettleStep = "queued" | "injuries" | "status" | "settlement" | "next_bout" | "done";

export type ChainWritePorts = {
  writeWinnerInjuries: (args: {
    subname: string;
    injuries: string[];
    ensLine: string;
  }) => Promise<string>;
  writeLoserStatusDead: (args: { subname: string; ensLine: string }) => Promise<string>;
  settleBattle: (battleId: string, winningSide: 0 | 1) => Promise<string>;
};

export type RecordedBattle = BattleQueueRecord & {
  videoUrl: string;
  recordedAt: number;
};

export type BattleQueueStore = {
  get(id: string): Promise<BattleQueueRecord | null>;
  save(record: BattleQueueRecord): Promise<void>;
  setVideoUrl(id: string, videoUrl: string): Promise<void>;
  listRecorded(): Promise<RecordedBattle[]>;
};

export function assertPlayableFightVideoUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") {
    throw new BattleQueueError(
      "fight video URL is blank. Refusing to store. Use the Spaces CDN URL from uploadFightVideo.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (cause) {
    throw new BattleQueueError(`fight video URL is not a valid URL: ${JSON.stringify(trimmed)}`, {
      cause,
    });
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "fal.media" || host.endsWith(".fal.media")) {
    throw new BattleQueueError(
      `fight video URL host ${JSON.stringify(parsed.hostname)} is fal.media. Store the Spaces CDN URL from uploadFightVideo, not the fal download URL.`,
    );
  }
  return trimmed;
}

export class BattleQueueError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BattleQueueError";
  }
}

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

export function markPlaybackFinished(record: BattleQueueRecord): BattleQueueRecord {
  return { ...record, playbackFinished: true };
}

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

export function nextSettleStep(record: BattleQueueRecord): SettleStep {
  if (record.injuriesTxHash === null) return "injuries";
  if (record.statusTxHash === null) return "status";
  if (record.settlementTxHash === null) return "settlement";
  return "next_bout";
}

const injuryListSchema = z.array(z.string());

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
    throw new BattleQueueError(`injuries text record is not JSON. Got: ${JSON.stringify(raw)}`, {
      cause,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new BattleQueueError(
      `injuries text record must be a JSON array. Got: ${JSON.stringify(raw)}`,
    );
  }
  const injuries = injuryListSchema.safeParse(parsed);
  if (!injuries.success) {
    throw new BattleQueueError(`injuries array items must be strings. Got: ${JSON.stringify(raw)}`);
  }
  return injuries.data;
}

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
}

function assertTxHash(hash: string, step: string): void {
  if (hash.trim() === "") {
    throw new BattleQueueError(`${step} write returned an empty transaction hash.`);
  }
}

function wrapStepError(step: string, record: BattleQueueRecord, cause: unknown): BattleQueueError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new BattleQueueError(
    `battle queue ${record.id} settle step ${step} failed (battleId=${record.battleId}). ${detail}`,
    { cause },
  );
}

export class MemoryBattleQueueStore implements BattleQueueStore {
  private readonly rows = new Map<string, BattleQueueRecord>();
  private readonly videoById = new Map<string, string>();
  private readonly insertionSequence = new Map<string, number>();
  private nextInsertionSequence = 0;

  async get(id: string): Promise<BattleQueueRecord | null> {
    const row = this.rows.get(id);
    return row === undefined ? null : structuredClone(row);
  }

  async save(record: BattleQueueRecord): Promise<void> {
    if (!this.rows.has(record.id)) {
      this.insertionSequence.set(record.id, this.nextInsertionSequence++);
    }
    this.rows.set(record.id, structuredClone(record));
  }

  async setVideoUrl(id: string, videoUrl: string): Promise<void> {
    const trimmed = assertPlayableFightVideoUrl(videoUrl);
    if (!this.rows.has(id)) {
      throw new BattleQueueError(
        `battle_results row ${JSON.stringify(id)} is missing. Cannot store fight video.`,
      );
    }
    this.videoById.set(id, trimmed);
  }

  async listRecorded(): Promise<RecordedBattle[]> {
    return [...this.rows.values()]
      .filter((row) => this.videoById.has(row.id))
      .sort((a, b) => this.insertionSequence.get(a.id)! - this.insertionSequence.get(b.id)!)
      .map((row) => ({
        ...structuredClone(row),
        videoUrl: this.videoById.get(row.id)!,
        recordedAt: this.insertionSequence.get(row.id)!,
      }));
  }
}
