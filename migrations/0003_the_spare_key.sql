-- 0003: THE SPARE KEY — self-service knock recovery, and the end of
-- founder resets (a founder could re-key a member and become them; no more).
--
-- HOW TO RUN (same law as 0001/0002 — once, by hand, after 0002):
--
--     wrangler d1 export fort --remote --output backup-prespare.sql
--     wrangler d1 execute fort --remote --file migrations/0003_the_spare_key.sql
--
-- Additive only. One atomic batch, no explicit BEGIN/COMMIT (remote D1 rejects them).

-- the spare key: cut once, shown once, written on paper, hidden like a dragon's
-- gold. using it at the door proves you're you when your knock is lost or stolen.
ALTER TABLE members ADD COLUMN spare_hash TEXT;              -- sha256(fort salt + SPARE...); plaintext lives on paper only
ALTER TABLE members ADD COLUMN spare_issued_at INTEGER;      -- NULL = the fort owes this member a spare

-- when a knock changes (self-change or spare use), every session issued before
-- that moment dies — a thief's stolen session does not outlive the re-keying.
ALTER TABLE members ADD COLUMN code_changed_at INTEGER;
