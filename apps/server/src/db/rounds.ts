import type { Client, Pool, PoolClient, QueryResultRow } from "pg";

type PgQueryable = Pool | PoolClient | Client;

export type SeasonCharacter = {
  ensLabel: string;
  alive: boolean;
  kills: number;
  damage: number;
};

export type RoundInsert = {
  seasonId: string;
  roundNumber: number;
  slots: 1 | 2;
  quorum: number;
  championLabel: string | null;
};

export type VoteInsert = {
  roundId: string;
  nullifier: string;
  picks: string[];
  /** ms epoch; the tally's reached_at is the latest of these per label. */
  at: number;
};

export type StoredTally = {
  ensLabel: string;
  voteCount: number;
  reachedAt: number;
};

/** Seasons, rounds, votes, and tallies (migration 001_game_loop.sql). */
export type RoundStore = {
  startSeason(characters: SeasonCharacter[]): Promise<string>;
  startRound(round: RoundInsert): Promise<string>;
  /** Throws DuplicateVoteError when this nullifier already voted in the round. */
  insertVote(vote: VoteInsert): Promise<void>;
  /** Counts the round's stored votes into tallies and returns the stored rows. */
  storeTally(roundId: string): Promise<StoredTally[]>;
};

export class DuplicateVoteError extends Error {
  constructor(roundId: string, nullifier: string) {
    super(`World ID nullifier already voted this round: ${nullifier} (rounds.id=${roundId}).`);
    this.name = "DuplicateVoteError";
  }
}

type IdRow = QueryResultRow & { id: string };
type TallyRow = QueryResultRow & { ens_label: string; vote_count: number; reached_at: Date };

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

  async startRound(round: RoundInsert): Promise<string> {
    const result = await this.db.query<IdRow>(
      `INSERT INTO rounds (season_id, round_number, phase, slots, quorum, champion_ens_label)
       VALUES ($1, $2, 'vote', $3, $4, $5) RETURNING id`,
      [round.seasonId, round.roundNumber, round.slots, round.quorum, round.championLabel],
    );
    return requireId(result.rows[0], "rounds");
  }

  async insertVote(vote: VoteInsert): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO votes (round_id, world_id_nullifier, picks, created_at)
         VALUES ($1, $2, $3, $4)`,
        [vote.roundId, vote.nullifier, vote.picks, new Date(vote.at)],
      );
    } catch (cause) {
      if (isUniqueViolation(cause, "votes_round_nullifier_unique")) {
        throw new DuplicateVoteError(vote.roundId, vote.nullifier);
      }
      throw cause;
    }
  }

  async storeTally(roundId: string): Promise<StoredTally[]> {
    const result = await this.db.query<TallyRow>(
      `INSERT INTO tallies (round_id, ens_label, vote_count, reached_at)
       SELECT v.round_id, pick, count(*)::int, max(v.created_at)
       FROM votes v CROSS JOIN LATERAL unnest(v.picks) AS pick
       WHERE v.round_id = $1
       GROUP BY v.round_id, pick
       RETURNING ens_label, vote_count, reached_at`,
      [roundId],
    );
    return result.rows.map((row) => ({
      ensLabel: row.ens_label,
      voteCount: row.vote_count,
      reachedAt: row.reached_at.getTime(),
    }));
  }
}

function requireId(row: IdRow | undefined, table: string): string {
  if (row === undefined) {
    throw new Error(`INSERT INTO ${table} returned no id.`);
  }
  return row.id;
}

function isUniqueViolation(cause: unknown, constraint: string): boolean {
  return (
    cause instanceof Error &&
    "code" in cause &&
    cause.code === "23505" &&
    "constraint" in cause &&
    cause.constraint === constraint
  );
}

/** In-process RoundStore with the same uniqueness and tally rules, for tests. */
export class MemoryRoundStore implements RoundStore {
  readonly seasons: SeasonCharacter[][] = [];
  readonly rounds = new Map<string, RoundInsert>();
  readonly votes: VoteInsert[] = [];
  readonly tallies = new Map<string, StoredTally[]>();

  async startSeason(characters: SeasonCharacter[]): Promise<string> {
    this.seasons.push(structuredClone(characters));
    return `season-${String(this.seasons.length)}`;
  }

  async startRound(round: RoundInsert): Promise<string> {
    const id = `round-${String(this.rounds.size + 1)}`;
    this.rounds.set(id, { ...round });
    return id;
  }

  async insertVote(vote: VoteInsert): Promise<void> {
    if (this.votes.some((v) => v.roundId === vote.roundId && v.nullifier === vote.nullifier)) {
      throw new DuplicateVoteError(vote.roundId, vote.nullifier);
    }
    this.votes.push(structuredClone(vote));
  }

  async storeTally(roundId: string): Promise<StoredTally[]> {
    if (this.tallies.has(roundId)) {
      throw new Error(
        `duplicate key value violates unique constraint "tallies_pkey" (round ${roundId})`,
      );
    }
    const byLabel = new Map<string, StoredTally>();
    for (const vote of this.votes.filter((v) => v.roundId === roundId)) {
      for (const label of vote.picks) {
        const prev = byLabel.get(label);
        byLabel.set(label, {
          ensLabel: label,
          voteCount: (prev?.voteCount ?? 0) + 1,
          reachedAt: Math.max(prev?.reachedAt ?? 0, vote.at),
        });
      }
    }
    const rows = [...byLabel.values()];
    this.tallies.set(roundId, rows);
    return structuredClone(rows);
  }
}
