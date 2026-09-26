-- Betting cutoff (issue #118): when a room reported the fight video playing,
-- and the deadline derived from it. Late votes and bets are rejected against
-- betting_closes_at.

ALTER TABLE battle_results
  ADD COLUMN IF NOT EXISTS video_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS betting_closes_at timestamptz;
