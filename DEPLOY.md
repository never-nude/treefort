# DEPLOY.md — treefort runbook (multi-fort era)

Michael's copy. Cut-paste top to bottom. Two different situations are covered:
**A. the live upgrade** (what prod needs right now: single-fort DB → multi-fort) and
**B. from zero** (a fresh install on a new account, should the tree ever burn down).

## A. THE GREAT RE-FORTING — upgrading live prod to multi-fort

Prod is currently: v2.1-era worker (single fort, hardcoded), single-fort D1 with real
posts in it, kids actively using it. The upgrade is three commands and one knock.
Sessions die once (everyone re-knocks with their same code). Posts survive. Codes survive.

```bash
cd /path/to/treefort

# 0) backup. always. (media lives in R2 and is untouched by all of this)
wrangler d1 export fort --remote --output backup-preforts-$(date +%F).sql

# 1) the migrations, in order — each is one atomic batch; if any statement
#    fails, NOTHING from that file applies. (deliberately no BEGIN/COMMIT —
#    remote D1 supplies its own transaction and rejects explicit ones.)
wrangler d1 execute fort --remote --file migrations/0001_multi_fort_foundation.sql
wrangler d1 execute fort --remote --file migrations/0002_the_tree_grows.sql

# 2) verify the migrations before deploying the worker that needs them:
wrangler d1 execute fort --remote --command "SELECT (SELECT COUNT(*) FROM posts WHERE fort_id='the_lookout') AS posts, (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM forts) AS forts, (SELECT companion_kind FROM forts WHERE id='the_lookout') AS lookout_staff"
#    posts must equal the pre-migration count. members >= 3. forts = 2. lookout_staff = dog.

# 3) ship the worker
wrangler deploy
```

Then the human step: knock at https://treefort.lol with Connor's code (his same code —
the salt traveled with the migration). You land in THE LOOKOUT as founder. Your same
code opens both The Lookout (as member) and Base Camp (as its founder).

Post-upgrade smoke test:
- [ ] treefort.lol redirects to treefort.lol/the_lookout/
- [ ] old bookmark treefort.lol/paint.html walks itself to /the_lookout/paint.html
- [ ] knock as Connor → wall shows every old post → all four room links work
- [ ] handbook room: visible to founders, 404 for members
- [ ] treefort.lol/base_camp/ → its own door; your code opens it; its wall is empty and its own
- [ ] a made-up fort URL shows the "wrong branch" sign, not raw JSON

## B. FROM ZERO — fresh install on a new Cloudflare account

1. https://dash.cloudflare.com/sign-up — free plan. Verify email.
   **R2 asterisk:** enabling R2 wants a card on file even though five kids of meme
   traffic is $0.00/mo. Dashboard → **R2 → Enable R2**, once.
2. CLI: `npm install -g wrangler && wrangler login && wrangler whoami`
3. Database: `wrangler d1 create fort` → paste the id into `wrangler.toml` → then
   **schema only** (fresh installs NEVER run migrations/0001 — that file is exclusively
   the legacy upgrade and will refuse an empty database on purpose):
   ```bash
   wrangler d1 execute fort --file schema.sql --remote
   ```
4. Bucket: `wrangler r2 bucket create fort-media`
5. Secrets:
   ```bash
   openssl rand -hex 32 | wrangler secret put SESSION_SECRET
   openssl rand -hex 16 | wrangler secret put SEED_TOKEN     # temporary, deleted in step 8
   ```
6. Deploy: `wrangler deploy`
7. Seed the founding forts (codes 4+ chars; tell people theirs in person, never email):
   ```bash
   curl -X POST https://treefort.lol/api/seed \
     -H 'Content-Type: application/json' \
     -d '{"token":"THE-SEED-TOKEN","connor_code":"CONNORS-CODE","kushman_code":"YOUR-LOOKOUT-CODE","base_camp_code":"YOUR-BASECAMP-CODE"}'
   ```
8. Lock the side door: `wrangler secret delete SEED_TOKEN`
   (seed refuses to run twice anyway, but a deleted secret refuses harder. re-set the
   secret temporarily any time you want /api/forts/create for founding a new fort.)
9. Domain (only if starting from scratch there too): Cloudflare → Add a site →
   treefort.lol → copy the two nameservers into Porkbun. Wait for "active" email.
   Routes are already in wrangler.toml; `wrangler deploy` again and done.

## Ops (all of it)

| thing | how |
|---|---|
| add a kid to a fort | that fort's founder: Workshop → ADD A MEMBER (handle + starter code) |
| kid lost/forgot their knock | THE SPARE KEY: door → "lost your knock?" → handle + spare → fresh knock (old knock + all old sessions die instantly). founders cannot reset anyone — whoever can re-key you can BE you |
| kid lost knock AND spare | break-glass below (operator-only), then they cut a new spare inside |
| change your own knock | Workshop → CHANGE MY KNOCK (any member) |
| let someone found their own fort | founder: Workshop → SAPLINGS → grow one; say the code to exactly one person. they plant it at treefort.lol → "i have a sapling". the nursery grows ONE sapling per day, max 5 unplanted; compost to make room |
| delete a post | founder session → remove button on the wall (media dies with it) |
| log a whole fort out at once | `wrangler d1 execute fort --remote --command "UPDATE forts SET gen=gen+1 WHERE id='the_lookout'"` — every session in that fort dies instantly; codes keep working |
| kick someone out of the tree | `wrangler d1 execute fort --remote --command "UPDATE members SET revoked=1, revoked_at=unixepoch() WHERE fort_id='the_lookout' AND handle='NAME'"` — session dies on next request, code stops opening the door, the record SURVIVES |
| let them back up | same, `SET revoked=0, revoked_at=NULL` |
| **freeze a fort (seal it)** | `wrangler d1 execute fort --remote --command "UPDATE forts SET frozen=1 WHERE id='SLUG'"` — every URL in it (pages, api, media) shows the seal, instantly. reversible: `frozen=0` |
| **freeze EVERYTHING** | `wrangler d1 execute fort --remote --command "UPDATE forts SET frozen=1"` — the big red switch |
| read the management's mailbox | `wrangler d1 execute fort --remote --command "SELECT id, fort_id, reason, contact, datetime(created_at,'unixepoch') AS at FROM reports ORDER BY id DESC LIMIT 20"` |
| who vouched for this fort? | `wrangler d1 execute fort --remote --command "WITH RECURSIVE chain(id, parent) AS (SELECT id, parent_fort FROM forts WHERE id='SLUG' UNION ALL SELECT f.id, f.parent_fort FROM forts f JOIN chain c ON f.id=c.parent) SELECT c.id, g.granted_by_handle AS vouched_by FROM chain c LEFT JOIN grants g ON g.used_by_fort=c.id"` |
| email alerts for reports/foundings | optional — enable the send_email blocks in wrangler.toml (see comments there). without them, reports still land in D1 |
| found a fort operator-side (no sapling) | re-set SEED_TOKEN, POST /api/forts/create, delete the token again |
| backup (monthly-ish) | `wrangler d1 export fort --remote --output backup-$(date +%F).sql` |
| costs | $0/mo at friend-group scale; Workers free tier is 100k requests/day |
| updates | edit files → `wrangler deploy` |

### If something truly bad gets posted (the incident playbook)

**Preserve, then remove.** Removal is instant; evidence can't be reconstructed after.

1. **Preserve**: `wrangler d1 export fort --remote --output incident-$(date +%F).sql`, and if
   media is involved, download the object first:
   `wrangler r2 object get fort-media/m/KEY --file incident-media-KEY`
2. **Remove**: tombstone the post (founder remove button, or the unpublish one-liner), or
   freeze the whole fort if it's bigger than one post.
3. **If it is CSAM or a child is in danger**: preserve (step 1), freeze the fort, and report
   to NCMEC (CyberTipline.org / 1-800-843-5678) and local law enforcement. Do NOT just
   delete — preservation is part of the legal obligation.
4. The grant chain tells you who vouched for the fort's owner (one-liner above) —
   that's a phone call to a parent you can actually make.

### Break-glass: a founder code is lost and nobody can reset it from inside

Codes hash per fort: `sha256(fort.salt + CODE_UPPERCASED)` into `members.code_hash`.
(The old procedure that wrote `config.founder_hash` is dead — nothing reads config anymore.)

```bash
# 1) get THAT FORT's salt
wrangler d1 execute fort --remote --command "SELECT salt FROM forts WHERE id='the_lookout'"
# 2) hash a new code with it
node -e 'const c=require("crypto");console.log(c.createHash("sha256").update(process.argv[1]+process.argv[2].toUpperCase()).digest("hex"))' SALT_HERE NEW-CODE
# 3) write it onto the member and log that fort out
wrangler d1 execute fort --remote --command "UPDATE members SET code_hash='HASH_HERE' WHERE fort_id='the_lookout' AND handle='CONNOR'"
wrangler d1 execute fort --remote --command "UPDATE forts SET gen=gen+1 WHERE id='the_lookout'"
```

Write founder codes on the DEED. By hand. Nowhere digital.

## What was verified before shipping (2026-07-08 hardening pass)

- doortest (node, stubbed D1/R2): seed, fort routing + canonical redirects, per-fort
  knocks + cross-fort session isolation, handbook founder gate, cooldown scoping,
  wall/upload/media/dictionary scoping, founder powers, mycode + bootstrap rate
  limits, logout, legacy Path=/ cookie retirement, friendly HTML 404, graceful 500
- migration 0001 replayed locally against a simulated copy of prod: posts identical,
  salt carried, both codes work after
- routing exercised through the real platform (`wrangler dev`, not just worker.fetch):
  /, /the_lookout/, all room pages, legacy redirects, robots.txt, security headers
- All page scripts pass `node --check`

The quiet safety layer (client canvas re-encode strips EXIF/GPS; media served only to
sessions of the owning fort; CSP blocks every external script/style/image; the fort
never emails, pings, or tracks anyone) is in the code, not in a settings page.
Nothing to operate.
