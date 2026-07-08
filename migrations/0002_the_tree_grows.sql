-- 0002: THE TREE GROWS — saplings, lineage, staff, the rules, the seal.
--
-- HOW TO RUN (same law as 0001 — once, by hand, after 0001; see DEPLOY.md):
--
--     wrangler d1 export fort --remote --output backup-pregrove.sql
--     wrangler d1 execute fort --remote --file migrations/0002_the_tree_grows.sql
--
-- Additive ONLY. No table is renamed, rebuilt, or dropped; every existing row —
-- posts, members, forts — is untouched. D1 runs the file as one atomic batch;
-- deliberately no BEGIN/COMMIT (remote D1 rejects explicit transactions).
-- Safe on a fresh install too (schema.sql will grow the same shapes).

-- saplings: a founder mints one, a new fort grows from it. the chain is
-- permanent record — rows are never deleted once used, so every fort traces
-- back to who vouched for its owner.
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,        -- sha256(SESSION_SECRET + TOKEN); plaintext lives nowhere
  granted_by_fort TEXT NOT NULL,
  granted_by_handle TEXT NOT NULL,
  note TEXT,                              -- founder's memo: who this sapling is for
  created_at INTEGER NOT NULL,
  used_at INTEGER,                        -- NULL = still plantable; consumed with a
  used_by_fort TEXT,                      --   conditional UPDATE so one sapling = one fort, ever
  FOREIGN KEY (granted_by_fort) REFERENCES forts(id)
);

-- lineage + staff + the seal, on the fort itself
ALTER TABLE forts ADD COLUMN parent_fort TEXT;              -- NULL = a root (the_lookout, base_camp)
ALTER TABLE forts ADD COLUMN founded_by_grant INTEGER;      -- NULL = predates saplings
ALTER TABLE forts ADD COLUMN companion_kind TEXT NOT NULL DEFAULT 'dog';  -- dog|cat|fern|pigeon|moth
ALTER TABLE forts ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0;           -- 1 = sealed pending review

-- kicked out of the tree ≠ erased from history. access dies on the next request;
-- the record survives (it is the record you need most in an incident).
ALTER TABLE members ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN revoked_at INTEGER;

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
  fort_id TEXT,                           -- NULL when filed from the grove
  page TEXT,
  reason TEXT NOT NULL,
  contact TEXT,                           -- optional, for a reply; never required
  created_at INTEGER NOT NULL,
  ip TEXT
);
