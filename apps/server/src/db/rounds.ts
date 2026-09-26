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

export type Voter = { kind: "human"; nullifier: string } | { kind: "bot"; address: string };

export type VoteInsert = {
  roundId: string;
  voter: Voter;
  picks: string[];
  at: number;
};

export type StoredTally = {
  ensLabel: string;
  voteCount: number;
  reachedAt: number;
};

export type RoundStore = {
  startSeason(characters: SeasonCharacter[]): Promise<string>;
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
        `INSERT INTO votes (round_id, world_id_nullifier, bot_address, picks, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          vote.roundId,
          vote.voter.kind === "human" ? vote.voter.nullifier : null,
          vote.voter.kind === "bot" ? vote.voter.address : null,
          vote.picks,
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
