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
  slug TEXT NOT NULL UNIQUE,               -- the ledger: globally unique, first-come-first-served, never changes
  display_name TEXT NOT NULL,
  dog_name TEXT NOT NULL DEFAULT 'DALE',   -- the companion's NAME, whatever species (legacy column name)
  gen INTEGER NOT NULL DEFAULT 1,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  renamed_at INTEGER,                     -- vestigial: names are carved at founding now
  parent_fort TEXT,                        -- lineage: NULL = a root fort
  founded_by_grant INTEGER,                -- which sapling grew this fort (NULL = predates saplings)
  companion_kind TEXT NOT NULL DEFAULT 'dog',  -- dog|cat|fern|pigeon|moth
  frozen INTEGER NOT NULL DEFAULT 0        -- 1 = sealed pending a raccoon council review
);

-- one row per person. the knock (a personal code) is what proves who you are, so
-- nobody can post under someone else's handle. we store only the hash of the code.
CREATE TABLE IF NOT EXISTS members (
  fort_id TEXT NOT NULL,
  handle TEXT NOT NULL,                    -- the name stamped on your posts
  code_hash TEXT NOT NULL,                 -- sha256(salt + CODE); the plaintext code lives nowhere
  is_founder INTEGER NOT NULL DEFAULT 0,   -- 1 = admin powers (delete, rename, manage roster)
  created_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,      -- kicked out of the tree; access dies, record survives
  revoked_at INTEGER,
  spare_hash TEXT,                         -- the spare key (hashed); plaintext lives on paper, hidden
  spare_issued_at INTEGER,                 -- NULL = the fort owes this member a spare
  code_changed_at INTEGER,                 -- sessions issued before this moment are dead
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
  deleted_by TEXT,                         -- whose hand removed it; every removal is signed
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

-- saplings: a founder mints one, a new fort grows from it. rows never deleted
-- once used — the chain is permanent record; every fort traces to its voucher.
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  granted_by_fort TEXT NOT NULL,
  granted_by_handle TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_fort TEXT,
  composted_at INTEGER,                    -- dead but dated; the daily clock still counts it
  FOREIGN KEY (granted_by_fort) REFERENCES forts(id)
);

-- the logbook: who knocked past which rules sign, and when
CREATE TABLE IF NOT EXISTS agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  rules_version INTEGER NOT NULL,
  agreed_at INTEGER NOT NULL,
  FOREIGN KEY (fort_id) REFERENCES forts(id)
);
CREATE INDEX IF NOT EXISTS idx_agreements_fort ON agreements(fort_id, handle);

-- the management's mailbox. no session required to write to it.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fort_id TEXT,
  page TEXT,
  reason TEXT NOT NULL,
  contact TEXT,
  created_at INTEGER NOT NULL,
  ip TEXT
);
