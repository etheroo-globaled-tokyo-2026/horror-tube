import type { Client, Pool, PoolClient, QueryResultRow } from "pg";

type PgQueryable = Pool | PoolClient | Client;

export type PoolResolution = "settled" | "cancelled" | "already_settled" | "already_cancelled";

export type UnresolvedPool = {
  battleId: string;
  poolId: string;
  openedAt: number;
};

export type PoolLedger = {
  recordOpened(battleId: string, poolId: string): Promise<void>;
  recordResolved(battleId: string, resolution: PoolResolution): Promise<void>;
  listUnresolved(): Promise<UnresolvedPool[]>;
};

type UnresolvedRow = QueryResultRow & { battle_id: string; pool_id: string; opened_at: Date };
type RecordedRow = QueryResultRow & { recorded: boolean };

function missingRow(battleId: string, resolution: PoolResolution): Error {
  return new Error(
    `sui_pools has no row for battle ${battleId}, so it cannot be marked ${resolution}. Pools are recorded when they open.`,
  );
}

export class PostgresPoolLedger implements PoolLedger {
  constructor(private readonly db: PgQueryable) {}

  async recordOpened(battleId: string, poolId: string): Promise<void> {
    await this.db.query("INSERT INTO sui_pools (battle_id, pool_id) VALUES ($1, $2)", [
      battleId,
      poolId,
    ]);
  }

  async recordResolved(battleId: string, resolution: PoolResolution): Promise<void> {
    const result = await this.db.query<RecordedRow>(
      `WITH resolved AS (
        UPDATE sui_pools SET resolved_at = now(), resolution = $2
        WHERE battle_id = $1 AND resolved_at IS NULL
      )
      SELECT EXISTS (SELECT 1 FROM sui_pools WHERE battle_id = $1) AS recorded`,
      [battleId, resolution],
    );
    if (result.rows[0]?.recorded !== true) throw missingRow(battleId, resolution);
  }

  async listUnresolved(): Promise<UnresolvedPool[]> {
    const result = await this.db.query<UnresolvedRow>(
      `SELECT battle_id, pool_id, opened_at FROM sui_pools
      WHERE resolved_at IS NULL
      ORDER BY opened_at, battle_id`,
    );
    return result.rows.map((row) => ({
      battleId: row.battle_id,
      poolId: row.pool_id,
      openedAt: row.opened_at.getTime(),
    }));
  }
}

type LedgerEntry = {
  poolId: string;
  openedAt: number;
  resolvedAt: number | null;
  resolution: PoolResolution | null;
};

export class MemoryPoolLedger implements PoolLedger {
  readonly entries = new Map<string, LedgerEntry>();

  async recordOpened(battleId: string, poolId: string): Promise<void> {
    if (this.entries.has(battleId)) {
      throw new Error(`sui_pools already has a row for battle ${battleId}.`);
    }
    this.entries.set(battleId, { poolId, openedAt: Date.now(), resolvedAt: null, resolution: null });
  }

  async recordResolved(battleId: string, resolution: PoolResolution): Promise<void> {
    const entry = this.entries.get(battleId);
    if (entry === undefined) throw missingRow(battleId, resolution);
    if (entry.resolvedAt !== null) return;
    entry.resolvedAt = Date.now();
    entry.resolution = resolution;
  }

  async listUnresolved(): Promise<UnresolvedPool[]> {
    return [...this.entries]
      .filter(([, entry]) => entry.resolvedAt === null)
      .map(([battleId, entry]) => ({ battleId, poolId: entry.poolId, openedAt: entry.openedAt }));
  }
}
