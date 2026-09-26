import type { Client, Pool, PoolClient, QueryResultRow } from "pg";

type PgQueryable = Pool | PoolClient | Client;

export type SeasonCharacter = {
  ensLabel: string;
  alive: boolean;
  kills: number;
  damage: number;
};

export type RoundStore = {
  startSeason(characters: SeasonCharacter[]): Promise<string>;
  endOpenSeasons(): Promise<string[]>;
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
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("INSERT INTO seasons returned no id.");
    }
    return row.id;
  }

  async endOpenSeasons(): Promise<string[]> {
    const result = await this.db.query<IdRow>(
      "UPDATE seasons SET ended_at = now() WHERE ended_at IS NULL RETURNING id",
    );
    return result.rows.map((row) => row.id);
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

export class MemoryRoundStore implements RoundStore {
  readonly seasons: SeasonCharacter[][] = [];
  readonly ended = new Map<string, { championLabel: string | null }>();

  async startSeason(characters: SeasonCharacter[]): Promise<string> {
    this.seasons.push(structuredClone(characters));
    return `season-${String(this.seasons.length)}`;
  }

  openSeasonIds(): string[] {
    return this.seasons
      .map((_, i) => `season-${String(i + 1)}`)
      .filter((id) => !this.ended.has(id));
  }

  async endOpenSeasons(): Promise<string[]> {
    const open = this.openSeasonIds();
    for (const id of open) this.ended.set(id, { championLabel: null });
    return open;
  }

  async endSeason(seasonId: string, championLabel: string | null): Promise<void> {
    if (!this.openSeasonIds().includes(seasonId)) {
      throw new Error(`endSeason: expected to end one open season ${seasonId}. Updated 0.`);
    }
    this.ended.set(seasonId, { championLabel });
  }
}
