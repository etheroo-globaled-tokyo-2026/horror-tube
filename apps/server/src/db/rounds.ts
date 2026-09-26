import type { Client, Pool, PoolClient, QueryResultRow } from "pg";

type PgQueryable = Pool | PoolClient | Client;

export type SeasonCharacter = {
  ensLabel: string;
  alive: boolean;
  kills: number;
  damage: number;
};

/** Seasons table only. Vote/rounds/tallies tables remain in the migration unused. */
export type RoundStore = {
  startSeason(characters: SeasonCharacter[]): Promise<string>;
  findOpenSeasonId(): Promise<string | null>;
  endSeason(seasonId: string, championLabel: string | null): Promise<void>;
};

type IdRow = QueryResultRow & { id: string };

export class PostgresRoundStore implements RoundStore {
  constructor(private readonly db: PgQueryable) {}

  async startSeason(characters: SeasonCharacter[]): Promise<string> {
    const result = await this.db.query<IdRow>(
      "INSERT INTO seasons (characters) VALUES ($1::jsonb) RETURNING id",
      [
        JSON.stringify(
          characters.map((c) => ({
            ens_label: c.ensLabel,
            alive: c.alive,
            kills: c.kills,
            damage: c.damage,
          })),
        ),
      ],
    );
    return requireId(result.rows[0], "seasons");
  }

  async findOpenSeasonId(): Promise<string | null> {
    const result = await this.db.query<IdRow>(
      `SELECT id FROM seasons WHERE ended_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    );
    const row = result.rows[0];
    return row === undefined ? null : row.id;
  }

  async endSeason(seasonId: string, championLabel: string | null): Promise<void> {
    const result = await this.db.query(
      `UPDATE seasons
       SET ended_at = now(), champion_ens_label = $2
       WHERE id = $1 AND ended_at IS NULL`,
      [seasonId, championLabel],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `endSeason: expected to end one open season ${seasonId}. Updated ${String(result.rowCount)}.`,
      );
    }
  }
}

function requireId(row: IdRow | undefined, table: string): string {
  if (row === undefined) {
    throw new Error(`INSERT INTO ${table} returned no id.`);
  }
  return row.id;
}

/** In-process RoundStore for tests. */
export class MemoryRoundStore implements RoundStore {
  readonly seasons: SeasonCharacter[][] = [];
  readonly seasonEnded = new Map<string, { championLabel: string | null }>();
  private openSeasonId: string | null = null;

  async startSeason(characters: SeasonCharacter[]): Promise<string> {
    this.seasons.push(structuredClone(characters));
    const id = `season-${String(this.seasons.length)}`;
    this.openSeasonId = id;
    return id;
  }

  async findOpenSeasonId(): Promise<string | null> {
    return this.openSeasonId;
  }

  async endSeason(seasonId: string, championLabel: string | null): Promise<void> {
    if (this.openSeasonId !== seasonId) {
      throw new Error(
        `endSeason: expected to end open season ${String(this.openSeasonId)}. Got ${seasonId}.`,
      );
    }
    this.seasonEnded.set(seasonId, { championLabel });
    this.openSeasonId = null;
  }
}
