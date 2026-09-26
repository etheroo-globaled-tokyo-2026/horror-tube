-- Live fight clip CDN URL (issue #189). Persisted when setVideoReady runs so
-- GET /replay can return it after RoundState.videoUrl is cleared.

ALTER TABLE battle_results
  ADD COLUMN IF NOT EXISTS video_url text;
