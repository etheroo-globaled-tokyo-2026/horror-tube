-- Battle-result queue (issue #60). Postgres holds the narration outcome while
-- betting is open; ENS writes and BattleBetting settle run after both gates.
-- Application tables live here, not in a worker object store.
-- schema_migrations is owned by the migrate runner.

CREATE TABLE IF NOT EXISTS battle_results (
  id uuid PRIMARY KEY,
  battle_id text NOT NULL,
  fighter_a_subname text NOT NULL,
  fighter_b_subname text NOT NULL,
  shots jsonb NOT NULL,
  ens_line_loser text NOT NULL,
  ens_line_winner text NOT NULL,
  rationale text NOT NULL,
  winner_subname text NOT NULL,
  loser_subname text NOT NULL,
  winner_injuries jsonb NOT NULL,
  next_opponent_subname text NOT NULL,
  betting_closed boolean NOT NULL DEFAULT false,
  playback_finished boolean NOT NULL DEFAULT false,
  injuries_tx_hash text,
  status_tx_hash text,
  settlement_tx_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battle_results_shots_array CHECK (jsonb_typeof(shots) = 'array'),
  CONSTRAINT battle_results_injuries_array CHECK (jsonb_typeof(winner_injuries) = 'array')
);

CREATE INDEX IF NOT EXISTS battle_results_battle_id_idx
  ON battle_results (battle_id);
