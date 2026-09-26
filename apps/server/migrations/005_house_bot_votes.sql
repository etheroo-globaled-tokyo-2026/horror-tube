-- House bot votes (issue #182). A bot has no World ID, so its vote is keyed by
-- its Sui address in its own column and can never collide with a nullifier.
-- Each row has exactly one voter identity; one vote per bot per round.

ALTER TABLE votes ALTER COLUMN world_id_nullifier DROP NOT NULL;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS bot_address text;
ALTER TABLE votes
  ADD CONSTRAINT votes_one_voter CHECK ((world_id_nullifier IS NULL) <> (bot_address IS NULL)),
  ADD CONSTRAINT votes_round_bot_unique UNIQUE (round_id, bot_address);
