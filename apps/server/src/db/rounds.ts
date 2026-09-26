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
  quorum: number;
  championLabel: string | null;
  fighterALabel: string;
  fighterBLabel: string;
};

export type Voter = { kind: "human"; nullifier: string } | { kind: "bot"; address: string };

export type VoteInsert = {
  roundId: string;
  voter: Voter;
  pick: string;
  at: number;
};

export type StoredTally = {
  ensLabel: string;
  voteCount: number;
  reachedAt: number;
};

export type RoundStore = {
  startSeason(characters: SeasonCharacter[]): Promise<string>;
  endOpenSeasons(): Promise<string[]>;
  endSeason(seasonId: string, championLabel: string | null): Promise<void>;
  startRound(round: RoundInsert): Promise<string>;
  insertVote(vote: VoteInsert): Promise<void>;
  storeTally(roundId: string): Promise<StoredTally[]>;
};

export class DuplicateVoteError extends Error {
  constructor(roundId: string, voter: Voter) {
    super(
      voter.kind === "human"
        ? `World ID nullifier already voted this round: ${voter.nullifier} (rounds.id=${roundId}).`
        : `House bot ${voter.address} already voted this round (rounds.id=${roundId}).`,
    );
    this.name = "DuplicateVoteError";
  }
}

const sameVoter = (a: Voter, b: Voter): boolean =>
  a.kind === "human"
    ? b.kind === "human" && a.nullifier === b.nullifier
    : b.kind === "bot" && a.address === b.address;

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

  async startRound(round: RoundInsert): Promise<string> {
    const result = await this.db.query<IdRow>(
      `INSERT INTO rounds (season_id, round_number, phase, slots, quorum, champion_ens_label,
         fighter_a_ens_label, fighter_b_ens_label)
       VALUES ($1, $2, 'vote', 1, $3, $4, $5, $6) RETURNING id`,
      [
        round.seasonId,
        round.roundNumber,
        round.quorum,
        round.championLabel,
        round.fighterALabel,
        round.fighterBLabel,
      ],
    );
    return requireId(result.rows[0], "rounds");
  }

  async insertVote(vote: VoteInsert): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO votes (round_id, world_id_nullifier, bot_address, picks, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          vote.roundId,
          vote.voter.kind === "human" ? vote.voter.nullifier : null,
          vote.voter.kind === "bot" ? vote.voter.address : null,
          [vote.pick],
          new Date(vote.at),
        ],
      );
    } catch (cause) {
      if (
        isUniqueViolation(cause, "votes_round_nullifier_unique") ||
        isUniqueViolation(cause, "votes_round_bot_unique")
      ) {
        throw new DuplicateVoteError(vote.roundId, vote.voter);
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

export class MemoryRoundStore implements RoundStore {
  readonly seasons: SeasonCharacter[][] = [];
  readonly rounds = new Map<string, RoundInsert>();
  readonly votes: VoteInsert[] = [];
  readonly tallies = new Map<string, StoredTally[]>();
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

  async startRound(round: RoundInsert): Promise<string> {
    const id = `round-${String(this.rounds.size + 1)}`;
    this.rounds.set(id, { ...round });
    return id;
  }

  async insertVote(vote: VoteInsert): Promise<void> {
    if (this.votes.some((v) => v.roundId === vote.roundId && sameVoter(v.voter, vote.voter))) {
      throw new DuplicateVoteError(vote.roundId, vote.voter);
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
      const prev = byLabel.get(vote.pick);
      byLabel.set(vote.pick, {
        ensLabel: vote.pick,
        voteCount: (prev?.voteCount ?? 0) + 1,
        reachedAt: Math.max(prev?.reachedAt ?? 0, vote.at),
      });
    }
    const rows = [...byLabel.values()];
    this.tallies.set(roundId, rows);
    return structuredClone(rows);
  }
}
