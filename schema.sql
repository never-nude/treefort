-- treefort v2 · the entire database. five kids. it will be fine.

CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  gen INTEGER NOT NULL DEFAULT 1,          -- bump = every session dies = the locks changed
  salt TEXT NOT NULL,
  fort_hash TEXT NOT NULL,                 -- sha256(salt + fort code)
  founder_hash TEXT NOT NULL,              -- sha256(salt + founder code)
  fort_name TEXT NOT NULL DEFAULT 'TREEFORT',
  dog_name TEXT NOT NULL DEFAULT 'DALE'
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT NOT NULL,
  type TEXT NOT NULL,                      -- text | image | meme | painting | gif
  text TEXT,
  media_key TEXT,
  created INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0       -- tombstone, never actually dropped
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created DESC);

CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id);

CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,
  def TEXT NOT NULL,
  example TEXT,
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',         -- '' | CERTIFIED | ON LIFE SUPPORT | DECEASED
  created INTEGER NOT NULL,
  died INTEGER                             -- date of death, graveyard paperwork
);

CREATE TABLE IF NOT EXISTS visits (
  name TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  knocks INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS knock_fails (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
