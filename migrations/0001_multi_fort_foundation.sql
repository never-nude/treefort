-- ONE-SHOT LEGACY UPGRADE: move the single-fort production data model under
-- The Lookout and create Base Camp with KUSHMAN as founder.
--
-- HOW TO RUN (this is NOT a `wrangler d1 migrations` file — run it exactly once,
-- by hand, against a legacy database; see DEPLOY.md "the great re-forting"):
--
--     wrangler d1 export fort --remote --output backup-preforts.sql   # first. always.
--     wrangler d1 execute fort --remote --file migrations/0001_multi_fort_foundation.sql
--
-- D1 runs the whole file as one implicitly-atomic batch, which is why there is
-- deliberately NO explicit BEGIN/COMMIT here — remote D1 rejects them ("cannot
-- start a transaction within a transaction") and would refuse the entire file.
-- No PRAGMA foreign_keys either (unsupported); statement order keeps every FK
-- valid at each step (forts exists before anything references it).
--
-- Assumptions for the live migration:
-- - The current production database is the pre-multi-fort (v2.1) schema: a config
--   row with THE salt, plus members/posts/replies/terms/visits/knock_fails.
--   Running this on a fresh empty database is wrong and will fail on the first
--   ALTER — fresh installs use schema.sql + POST /api/seed instead.
-- - Existing members/posts/replies/terms/visits/knock_fails all belong to Connor's
--   fort and are copied to fort_id='the_lookout'.
-- - Both forts get the legacy config salt ON PURPOSE: KUSHMAN's Base Camp founder
--   row reuses his existing code hash (SQL cannot rehash a code it never sees),
--   and a hash is only portable between forts if the salt is too. Forts created
--   after this migration get their own random salts (see createFort in worker.js).
-- - KUSHMAN must exist in the legacy members table; if he doesn't, the Base Camp
--   founder INSERT aborts on the NOT NULL code_hash constraint and — because the
--   batch is atomic — the WHOLE migration rolls back. That is intentional: Base
--   Camp must not exist without its founder.
-- - Legacy tables are renamed, not dropped, so old data remains available for audit.

CREATE TABLE IF NOT EXISTS forts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  dog_name TEXT NOT NULL DEFAULT 'DALE',
  gen INTEGER NOT NULL DEFAULT 1,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  renamed_at INTEGER
);

-- No COALESCE(random) fallback on the salt: if config is missing this yields NULL,
-- the NOT NULL constraint aborts, and the atomic batch rolls back everything.
-- Better a loud refusal than two forts with silently forked salts.
INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at)
SELECT
  'the_lookout',
  'the_lookout',
  'The Lookout',
  COALESCE((SELECT dog_name FROM config WHERE id = 1), 'DALE'),
  COALESCE((SELECT gen FROM config WHERE id = 1), 1),
  (SELECT salt FROM config WHERE id = 1),
  CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM forts WHERE id = 'the_lookout');

INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at)
SELECT
  'base_camp',
  'base_camp',
  'Base Camp',
  'DALE',
  1,
  (SELECT salt FROM config WHERE id = 1),
  CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM forts WHERE id = 'base_camp');

ALTER TABLE members RENAME TO members_legacy_single_fort;

CREATE TABLE members (
  fort_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  is_founder INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER,
  PRIMARY KEY (fort_id, handle),
  UNIQUE (fort_id, code_hash),
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);

INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at)
SELECT 'the_lookout', handle, code_hash, is_founder, created_at
FROM members_legacy_single_fort;

-- This intentionally aborts on the NOT NULL code_hash constraint if KUSHMAN is
-- missing from the legacy roster. Base Camp must not deploy without its founder.
INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at)
SELECT
  'base_camp',
  'KUSHMAN',
  (SELECT code_hash FROM members_legacy_single_fort WHERE handle = 'KUSHMAN'),
  1,
  COALESCE((SELECT created_at FROM members_legacy_single_fort WHERE handle = 'KUSHMAN'), CAST(strftime('%s', 'now') AS INTEGER));

CREATE INDEX IF NOT EXISTS idx_members_fort_code ON members(fort_id, code_hash);

ALTER TABLE posts RENAME TO posts_legacy_single_fort;

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT NOT NULL,
  author TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT,
  media_key TEXT,
  created INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);

INSERT INTO posts (id, fort_id, author, type, text, media_key, created, deleted)
SELECT id, 'the_lookout', author, type, text, media_key, created, deleted
FROM posts_legacy_single_fort;

CREATE INDEX IF NOT EXISTS idx_posts_fort_id ON posts(fort_id, id DESC);

ALTER TABLE replies RENAME TO replies_legacy_single_fort;

CREATE TABLE replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created INTEGER NOT NULL,
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);

INSERT INTO replies (id, fort_id, post_id, author, text, created)
SELECT id, 'the_lookout', post_id, author, text, created
FROM replies_legacy_single_fort;

CREATE INDEX IF NOT EXISTS idx_replies_fort_post ON replies(fort_id, post_id);

ALTER TABLE terms RENAME TO terms_legacy_single_fort;

CREATE TABLE terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT NOT NULL,
  term TEXT NOT NULL,
  def TEXT NOT NULL,
  example TEXT,
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,
  died INTEGER,
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);

INSERT INTO terms (id, fort_id, term, def, example, author, status, created, died)
SELECT id, 'the_lookout', term, def, example, author, status, created, died
FROM terms_legacy_single_fort;

CREATE INDEX IF NOT EXISTS idx_terms_fort_id ON terms(fort_id, id DESC);

ALTER TABLE visits RENAME TO visits_legacy_single_fort;

CREATE TABLE visits (
  fort_id TEXT NOT NULL,
  name TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  knocks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fort_id, name),
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);

INSERT INTO visits (fort_id, name, first_seen, last_seen, knocks)
SELECT 'the_lookout', name, first_seen, last_seen, knocks
FROM visits_legacy_single_fort;

ALTER TABLE knock_fails RENAME TO knock_fails_legacy_single_fort;

CREATE TABLE knock_fails (
  fort_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (fort_id, ip),
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);

INSERT INTO knock_fails (fort_id, ip, fails, window_start)
SELECT 'the_lookout', ip, fails, window_start
FROM knock_fails_legacy_single_fort;
