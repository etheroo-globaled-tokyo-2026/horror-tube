-- The room's fighter pick is the only choice before betting, so rounds no
-- longer collect votes.

DROP TABLE IF EXISTS tallies;
DROP TABLE IF EXISTS votes;
ALTER TABLE rounds DROP COLUMN IF EXISTS quorum;
