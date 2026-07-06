-- Milestone 1: move the existing single-fort data model under The Lookout
-- and create Base Camp with KUSHMAN as founder.
--
-- Assumptions for the live migration:
-- - The current production database is the pre-multi-fort schema from schema.sql.
-- - Existing members/posts/replies/terms/visits/knock_fails all belong to Connor's
--   fort and are copied to fort_id='the_lookout'.
-- - KUSHMAN already exists in the old members table; his existing code hash is reused
--   for Base Camp during migration because D1 SQL does not know plaintext knocks. If
--   Base Camp needs a different starter knock, update only (base_camp, KUSHMAN) after
--   migration with a deployment-only hash computed from Base Camp's salt.
-- - Legacy tables are renamed, not dropped, so old data remains available for audit.

PRAGMA foreign_keys = off;

BEGIN TRANSACTION;

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

INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at)
SELECT
  'the_lookout',
  'the_lookout',
  'The Lookout',
  COALESCE((SELECT dog_name FROM config WHERE id = 1), 'DALE'),
  COALESCE((SELECT gen FROM config WHERE id = 1), 1),
  COALESCE((SELECT salt FROM config WHERE id = 1), lower(hex(randomblob(16)))),
  CAST(strftime('%s', 'now') AS INTEGER)
WHERE NOT EXISTS (SELECT 1 FROM forts WHERE id = 'the_lookout');

INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at)
SELECT
  'base_camp',
  'base_camp',
  'Base Camp',
  'DALE',
  1,
  COALESCE((SELECT salt FROM config WHERE id = 1), lower(hex(randomblob(16)))),
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

COMMIT;

PRAGMA foreign_keys = on;
