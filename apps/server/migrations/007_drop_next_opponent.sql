-- The pairing LLM picks each bout's pair before the vote, so narration no
-- longer stores a next opponent.

ALTER TABLE battle_results DROP COLUMN IF EXISTS next_opponent_subname;
