-- Game-loop tables (docs/game-loop.md, issue #69).
-- Character ids are ENS labels. No stakes table.
-- Character alive/kills/damage live on seasons.characters (jsonb).
-- gen_random_uuid() is built into PostgreSQL 13+ (Managed Postgres on DigitalOcean).

CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  champion_ens_label text,
  -- [{ "ens_label": string, "alive": boolean, "kills": number, "damage": number }, ...]
  characters jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES seasons (id),
  round_number integer NOT NULL,
  phase text NOT NULL,
  slots smallint NOT NULL,
  quorum integer NOT NULL,
  champion_ens_label text,
  fighter_a_ens_label text,
  fighter_b_ens_label text,
  video_url text,
  error text,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rounds_slots_check CHECK (slots IN (1, 2)),
  CONSTRAINT rounds_season_round_unique UNIQUE (season_id, round_number)
);

CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES rounds (id),
  world_id_nullifier text NOT NULL,
  picks text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT votes_round_nullifier_unique UNIQUE (round_id, world_id_nullifier)
);

CREATE TABLE IF NOT EXISTS tallies (
  round_id uuid NOT NULL REFERENCES rounds (id),
  ens_label text NOT NULL,
  vote_count integer NOT NULL,
  -- When this ens_label first reached vote_count. Tie-break: earlier reached_at wins.
  reached_at timestamptz NOT NULL,
  CONSTRAINT tallies_vote_count_check CHECK (vote_count >= 0),
  PRIMARY KEY (round_id, ens_label)
);
