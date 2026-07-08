-- 0004: YOUR POST, YOUR CALL — authors can remove their own posts, and every
-- removal is signed. the management keeps its rule-4 power, but the tombstone
-- now says whose hand did it. accountability is the whole feature.
--
-- HOW TO RUN (same law as always — once, by hand, after 0003):
--
--     wrangler d1 execute fort --remote --file migrations/0004_your_post_your_call.sql
--
-- Additive only. One atomic batch, no explicit BEGIN/COMMIT.

ALTER TABLE posts ADD COLUMN deleted_by TEXT;   -- NULL on old tombstones = the dog did it, historically
