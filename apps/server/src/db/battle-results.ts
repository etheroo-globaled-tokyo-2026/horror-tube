import type {
  BattleQueueRecord,
  BattleQueueStore,
  Shot,
} from "@horror-tube/fight/battle-queue";
import type { Client, Pool, PoolClient, QueryResultRow } from "pg";

import { readDatabaseUrl } from "./database-url.js";

type PgQueryable = Pool | PoolClient | Client;

type BattleResultRow = QueryResultRow & {
  id: string;
  battle_id: string;
  fighter_a_subname: string;
  fighter_b_subname: string;
  shots: Shot[] | string;
  ens_line_loser: string;
  ens_line_winner: string;
  rationale: string;
  winner_subname: string;
  loser_subname: string;
  winner_injuries: string[] | string;
  next_opponent_subname: string;
  betting_closed: boolean;
  playback_finished: boolean;
  injuries_tx_hash: string | null;
  status_tx_hash: string | null;
  settlement_tx_hash: string | null;
};

function parseJsonArray<T>(value: T[] | string, field: string): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error(
        `battle_results.${field} must be a JSON array. Got: ${JSON.stringify(value)}`,
      );
    }
    return parsed as T[];
  }
  throw new Error(
    `battle_results.${field} must be a JSON array. Got: ${JSON.stringify(value)}`,
  );
}

function rowToRecord(row: BattleResultRow): BattleQueueRecord {
  return {
    id: row.id,
    battleId: row.battle_id,
    fighterASubname: row.fighter_a_subname,
    fighterBSubname: row.fighter_b_subname,
    shots: parseJsonArray<Shot>(row.shots, "shots"),
    ensLines: [row.ens_line_loser, row.ens_line_winner],
    rationale: row.rationale,
    winnerSubname: row.winner_subname,
    loserSubname: row.loser_subname,
    winnerInjuries: parseJsonArray<string>(row.winner_injuries, "winner_injuries"),
    nextOpponentSubname: row.next_opponent_subname,
    bettingClosed: row.betting_closed,
    playbackFinished: row.playback_finished,
    injuriesTxHash: row.injuries_tx_hash,
    statusTxHash: row.status_tx_hash,
    settlementTxHash: row.settlement_tx_hash,
  };
}

/**
 * Postgres-backed battle-result queue. Requires DATABASE_URL (see .env.example).
 * This is not a second database — same Managed Postgres as seasons/rounds.
 */
export class PostgresBattleQueueStore implements BattleQueueStore {
  constructor(private readonly db: PgQueryable) {}

  async get(id: string): Promise<BattleQueueRecord | null> {
    const result = await this.db.query<BattleResultRow>(
      `SELECT
        id, battle_id, fighter_a_subname, fighter_b_subname, shots,
        ens_line_loser, ens_line_winner, rationale,
        winner_subname, loser_subname, winner_injuries, next_opponent_subname,
        betting_closed, playback_finished,
        injuries_tx_hash, status_tx_hash, settlement_tx_hash
      FROM battle_results
      WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : rowToRecord(row);
  }

  async save(record: BattleQueueRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO battle_results (
        id, battle_id, fighter_a_subname, fighter_b_subname, shots,
        ens_line_loser, ens_line_winner, rationale,
        winner_subname, loser_subname, winner_injuries, next_opponent_subname,
        betting_closed, playback_finished,
        injuries_tx_hash, status_tx_hash, settlement_tx_hash,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb,
        $6, $7, $8,
        $9, $10, $11::jsonb, $12,
        $13, $14,
        $15, $16, $17,
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        battle_id = EXCLUDED.battle_id,
        fighter_a_subname = EXCLUDED.fighter_a_subname,
        fighter_b_subname = EXCLUDED.fighter_b_subname,
        shots = EXCLUDED.shots,
        ens_line_loser = EXCLUDED.ens_line_loser,
        ens_line_winner = EXCLUDED.ens_line_winner,
        rationale = EXCLUDED.rationale,
        winner_subname = EXCLUDED.winner_subname,
        loser_subname = EXCLUDED.loser_subname,
        winner_injuries = EXCLUDED.winner_injuries,
        next_opponent_subname = EXCLUDED.next_opponent_subname,
        betting_closed = EXCLUDED.betting_closed,
        playback_finished = EXCLUDED.playback_finished,
        injuries_tx_hash = EXCLUDED.injuries_tx_hash,
        status_tx_hash = EXCLUDED.status_tx_hash,
        settlement_tx_hash = EXCLUDED.settlement_tx_hash,
        updated_at = now()`,
      [
        record.id,
        record.battleId,
        record.fighterASubname,
        record.fighterBSubname,
        JSON.stringify(record.shots),
        record.ensLines[0],
        record.ensLines[1],
        record.rationale,
        record.winnerSubname,
        record.loserSubname,
        JSON.stringify(record.winnerInjuries),
        record.nextOpponentSubname,
        record.bettingClosed,
        record.playbackFinished,
        record.injuriesTxHash,
        record.statusTxHash,
        record.settlementTxHash,
      ],
    );
  }
}

/** Fail closed when DATABASE_URL is missing or blank. */
export function requireDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return readDatabaseUrl(env);
}
