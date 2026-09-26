-- Sui pool ledger: every pool the operator opened, until it is settled or
-- cancelled. The live battle id is otherwise only in memory, so a restart
-- mid-round leaves its pool open; the startup sweep cancels unresolved rows.

CREATE TABLE IF NOT EXISTS sui_pools (
  battle_id text PRIMARY KEY,
  pool_id text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text,
  CONSTRAINT sui_pools_resolution_check
    CHECK (resolution IN ('settled', 'cancelled', 'already_settled', 'already_cancelled')),
  CONSTRAINT sui_pools_resolved_with_resolution
    CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
