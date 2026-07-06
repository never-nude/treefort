-- treefort v3 · multiple forts. still five-ish kids. still fine.

-- legacy v1/v2 config. kept so old installs can be migrated without guessing salts.
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  gen INTEGER NOT NULL DEFAULT 1,          -- bump = every session dies (kept for future mass re-key)
  salt TEXT NOT NULL,
  fort_hash TEXT NOT NULL,                 -- legacy (v1 shared fort code) — unused since per-person knocks
  founder_hash TEXT NOT NULL,              -- legacy (v1 single founder code) — unused since per-person knocks
  fort_name TEXT NOT NULL DEFAULT 'TREEFORT',
  dog_name TEXT NOT NULL DEFAULT 'DALE'
);

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

-- one row per person. the knock (a personal code) is what proves who you are, so
-- nobody can post under someone else's handle. we store only the hash of the code.
CREATE TABLE IF NOT EXISTS members (
  fort_id TEXT NOT NULL,
  handle TEXT NOT NULL,                    -- the name stamped on your posts
  code_hash TEXT NOT NULL,                 -- sha256(salt + CODE); the plaintext code lives nowhere
  is_founder INTEGER NOT NULL DEFAULT 0,   -- 1 = admin powers (delete, rename, manage roster)
  created_at INTEGER,
  PRIMARY KEY (fort_id, handle),
  UNIQUE (fort_id, code_hash),
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);
CREATE INDEX IF NOT EXISTS idx_members_fort_code ON members(fort_id, code_hash);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT NOT NULL,
  author TEXT NOT NULL,
  type TEXT NOT NULL,                      -- text | image | meme | painting | gif
  text TEXT,
  media_key TEXT,
  created INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,      -- tombstone, never actually dropped
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);
CREATE INDEX IF NOT EXISTS idx_posts_fort_id ON posts(fort_id, id DESC);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created INTEGER NOT NULL,
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);
CREATE INDEX IF NOT EXISTS idx_replies_fort_post ON replies(fort_id, post_id);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT NOT NULL,
  term TEXT NOT NULL,
  def TEXT NOT NULL,
  example TEXT,
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',         -- '' | CERTIFIED | ON LIFE SUPPORT | DECEASED
  created INTEGER NOT NULL,
  died INTEGER,                            -- date of death, graveyard paperwork
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);
CREATE INDEX IF NOT EXISTS idx_terms_fort_id ON terms(fort_id, id DESC);

CREATE TABLE IF NOT EXISTS visits (
  fort_id TEXT NOT NULL,
  name TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  knocks INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fort_id, name),
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);

CREATE TABLE IF NOT EXISTS knock_fails (
  fort_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (fort_id, ip),
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);
