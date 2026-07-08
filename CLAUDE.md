# CLAUDE.md — treefort.lol

Private multi-fort clubhouse website for Connor (13), Michael, and invited friends. Built as a gift by
Michael. Bart Simpson's treehouse as a website: old-internet energy, deadpan absurdism,
no engagement mechanics of any kind. **Live at https://treefort.lol since 2026-07-02**
(Cloudflare account: michael.kushman@gmail.com; DNS via Porkbun → Cloudflare nameservers;
workers.dev route disabled — the fort has exactly one address).

## Architecture

One Cloudflare Worker + D1 (SQLite) + R2 (media). Multi-fort routing is path-based:
`/the_lookout/` is Connor's current fort and `/base_camp/` is Michael's fort. The
same static room files render for each fort; the Worker resolves the fort slug and
scopes every API call. **Zero dependencies, no build step,
no framework, no npm install.** This is a load-bearing constraint, not an accident —
every page is a single readable file because the 13-year-old owner is meant to read
and mod the source. Do not introduce bundlers, frameworks, libraries, or CDN scripts.

**Routing law (learned the hard way, 2026-07-08):** `wrangler.toml` sets
`run_worker_first = true` + `html_handling = "none"` so the Worker owns EVERY request
and `env.ASSETS.fetch()` returns files, never redirects. Do not switch back to a
run_worker_first glob list — the asset platform's html_handling was 307-ing fort paths
(`/the_lookout/paint.html` → `/paint`) into dead ends. Legacy root URLs (`/paint.html`
etc.) 301 to `/the_lookout/…`; `/` 302s to `/the_lookout/`; unknown fort slugs get an
in-voice HTML "wrong branch" page for browsers, JSON for API paths.

| path | what |
|---|---|
| `src/worker.js` | entire backend: code-gate auth, sessions, wall, dictionary, media, founder ops |
| `schema.sql` | entire database (D1) |
| `migrations/0001_multi_fort_foundation.sql` | one-time live migration from single fort to multi-fort |
| `public/index.html` | the fort: door theater, bulletin, wall, dictionary, workshop, pixel dog |
| `public/paint.html` | drawing tool + animation frames (onion skin) |
| `public/kitchen.html` | meme maker (impact text, draw layer, remix-from-wall) + the moving pictures department: hand-written GIF89a **decoder** (twin of the gif machine's encoder, same do-not-replace-with-a-library rule), letters on every frame, MAKE IT MOVE AGAIN re-encode with speed/direction knobs |
| `public/handbook.html` | the founder's field manual — served only to a founder of the CURRENT fort (Worker-gated), hidden from members |
| `public/gifmachine.html` | client-side GIF89a encoder — **hand-written LZW, do not replace with a library** — plus the projection booth: .mov/.mp4 → frames → gif, fully in-browser, video never uploaded |
| `test/doortest.mjs` | full API integration test, stubbed D1/R2 — `node test/doortest.mjs` |
| `DEPLOY.md` | the runbook (account → wrangler → D1/R2 → setup call → Porkbun nameservers) |

## The tree grows (Phase 3, 2026-07-08)

- **The grove** (`public/grove.html`, served at `/`): landing page that denies everything.
  No fort directory — ladders come from the device's own `tf_grove_ladders` localStorage
  (fort pages plant a ladder on every successful knock). First-timers whisper a fort's
  NAME; ground links: "i have a sapling" → `/plant`, "speak to the management" → `/rules#management`.
- **Saplings** (`grants` table): one-use founding codes minted by founders (Workshop →
  SAPLINGS, ONE per fort per day — D1-clocked from the last grown, ≤5 unused). Token shown exactly once, stored hashed. `POST /api/found` consumes
  one conditionally (race-proof) and creates fort+founder+agreement atomically-ish with a
  compensating revert on naming races. The chain (`forts.parent_fort`, `founded_by_grant`)
  is permanent record.
- **Naming law**: display 2–18 printable ASCII; slug unique forever; collisions offer
  "Name 2" explicitly (TAKE THE 2), reserved slugs (`RESERVED_SLUGS` in worker.js) refused.
- **Companions**: `COMPANIONS` in index.html — dog | cat | fern | pigeon | moth, each with
  lines/snacks/takes/mgmt line and a procedural sprite (drawStaff dispatch). THE LOOKOUT's
  staff is DALE (dog), forever. No raccoon companion — the council stays external.
- **The treehouse rules**: RULES_VERSION in worker.js; the six rules text is IDENTICAL in
  index.html (door overlay), plant.html (founding), rules.html (public) — change all three
  together and bump the version (everyone re-knocks the sign once). Agreements logged.
- **Moderation**: `POST /api/report` (no session, 3/hr/IP) + optional operator email
  (wrangler.toml send_email blocks); `forts.frozen` seals every route; `members.revoked`
  kicks someone out with the record preserved. Operator one-liners + incident playbook in
  DEPLOY.md. Glossary is binding: sapling / treehouse rules / speak to the management /
  sealed / kicked out of the tree — system words never on kid-facing screens.

## Fort canon

- Connor's fort: display name `The Lookout`, slug `the_lookout`, founder `CONNOR`.
- Michael's fort: display name `Base Camp`, slug `base_camp`, founder `KUSHMAN`.
- Display names and handles preserve capitalization. Canonical URLs are lowercase.
- Fort URLs are case-insensitive; spaces normalize to underscores; slugs allow only
  lowercase `a-z`, `0-9`, and `_`.
- Existing single-fort production data, including wall posts and media references,
  belongs to `the_lookout`.

## Access model (the whole point — do not "improve" it)

**Fort URL + per-person knock (v3 foundation, 2026-07-06).** The old shared-fort-code +
single-founder-code model is retired (`config.fort_hash`/`founder_hash` are legacy,
unused). Now:

- No accounts, no emails, no passwords stored — one `members` row per person per fort:
  `fort_id` + `handle` + `code_hash` (sha256(fort salt + CODE)) + `is_founder`.
  The plaintext code lives nowhere.
- **Authentication is the fort URL plus one knock code.** No name is typed at the door —
  the code resolves to exactly one member inside that fort, whose `handle` is stamped on
  their posts. This is what kills impersonation; do not add a name field back.
- Founder powers (delete posts, dict status, roster, add members, mint saplings). NO renames
  of anything (fort + staff carved at founding) and NO knock resets for others
  gate on `is_founder` inside the current fort.
- **Recovery flow = THE SPARE KEY** (`/api/spare/cut` in-session, shown once, stored hashed;
  `/api/spare/use` at the door, no session: handle + spare -> fresh knock, spare consumed,
  and every session issued before the re-key dies via members.code_changed_at). Founder
  resets are gone forever: whoever can re-key a member can BE them. Anyone can
  change their own knock (`/api/mycode`, proves current code first). No self-service founder
  reset — losing the founder code is still break-glass (DEPLOY.md), Michael holds the backstop.
- Codes are unique only within a fort: `(fort_id, code_hash)`. The same knock code may
  exist in two different forts.
- One-time `/api/seed` (guarded by `SEED_TOKEN` worker secret) grandfathers the first
  forts/members on fresh installs, then refuses forever once any fort exists. Secret is
  deleted post-seed. Fresh seed accepts `kushman_code` for KUSHMAN in The Lookout and
  `base_camp_code` for KUSHMAN as Base Camp founder; these may differ.
- Sessions: signed HTTP-only cookie (HMAC, 90d) with fort id, fort gen, role, handle, and
  expiry. The handle comes from the cookie, but powers are re-read from `members` on every
  request so old cookies cannot keep stale founder/member status. `forts.gen` is retained
  for future mass re-key.
- `CONNOR` and `JAMIE` (little brother, 9) get bespoke door greetings. Wrong knock x5 per IP
  → 10-minute cooldown.

## Hard nos (from the project brief — enforce these in code review)

No accounts · no emails · no algorithm · no likes/counts · no streaks · no
notifications · no ads · no analytics · no AI moderation · no content filters ·
no third-party embeds/scripts/fonts · no gamified engagement · no infinite scroll.
The fort never pings anyone. Backstop = Michael's founder code + human judgment, not software.

Quiet safety (keep intact): uploads re-encode through canvas client-side (strips
EXIF/GPS), media only served with a valid session, magic-byte sniffing + size caps
(4MB img / 10MB gif) at the Worker, per-session rate limits.

## Voice / copy register

Lowercase terminal deadpan, absurd specificity, never corporate, never explains the
joke. Calibration examples: "checking if you are a narc... NOT A NARC" ·
"removed by the management. the management is a dog." · "the raccoon council has been
notified." If a new line wouldn't survive next to those, cut it. Don't punch at anyone.
Smart-13-year-old register: never condescend, never "hello fellow kids."

## Canon (affects jokes, don't contradict)

- The dog is DALE (government name DALE; street name founder-configurable). He is
  "the staff" and "the management." (He filed perimeter reports until the lookout
  was decommissioned — see below.)
- PATRICIA is the poster (Miss Fort 1944, a poodle). DALE won't discuss the calendar shoot.
- Secrets: footer advertises 3; truth is 5 (moon x3 `moon`, typing the dog's name
  `name`, defining "fort" in the dictionary `lexicon`, full 16-color palette in paint
  `palette`, wordless meme `silence`). Counter overflow (e.g. 5/3) is intentional.
  `SECRET_IDS` in index.html is the authoritative roster — the counter prunes ids
  not on it, so a new secret's id must be added there or it won't count.
- The lookout, the locked door (???), and the oracle were removed 2026-07-02 at
  Michael's request (their two secrets `door`/`source` retired with them; the
  source letter marks the decommissioning). Do not resurrect them without asking.
- Attendance counts total days ever, NEVER consecutive streaks ("the fort is not your boss")
- Every page opens with a source-code letter to Connor. Update it when rooms change.

## Commands

```bash
node test/doortest.mjs                                  # API integration test (offline, stubbed)
wrangler dev                                            # local dev (needs D1 id in wrangler.toml)
wrangler deploy                                         # ship
wrangler d1 execute fort --file schema.sql --remote     # apply schema (FRESH installs only)
wrangler d1 execute fort --remote --file migrations/0001_multi_fort_foundation.sql
                                                        # legacy single-fort upgrade, ONCE, by hand.
                                                        # NEVER `wrangler d1 migrations apply` — 0001
                                                        # is not a migrations-dir file and refuses
                                                        # fresh DBs on purpose. see DEPLOY.md.
wrangler d1 export fort --remote --output backup.sql    # backup
```

Client pages have no test harness; changes there = manual check in browser + `node --check`
on the extracted script block.

## Verified before handoff (refreshed 2026-07-08 hardening pass)

- doortest: seed + fort routing + canonical redirects, per-fort knocks with cross-fort
  session isolation, handbook founder gate, cooldown scoping, wall/upload/media/dict
  scoping, founder powers, mycode + bootstrap rate limits, logout, legacy Path=/
  cookie retirement, friendly HTML 404, graceful deadpan 500
- migration 0001 replayed locally against a simulated prod copy: posts byte-identical,
  salt carried, both existing codes still open the door
- GIF encoder: byte-exact decode roundtrip vs PIL through all LZW code-width
  transitions (9→12 bits) and a 4096-entry dictionary reset
- `wrangler.toml` has the live D1 id and custom-domain routes (the routes block must stay
  ABOVE the `[[...]]` tables — TOML otherwise adopts it into `r2_buckets` and wrangler
  silently skips the domains; this bit us once)

## Known deliberate quirks

- `/api/setup` is legacy single-fort bootstrap. Multi-fort fresh installs should use
  `/api/seed`; live single-fort installs should use the migration file first.
- In-memory rate-limit buckets are per-isolate best-effort — fine for five kids
- GIF palette is fixed 3-3-2 (256 colors), no dithering: crunchy on purpose
- localStorage is namespaced per fort AND per device: `the_lookout` keeps the original
  bare `tf_*` keys (so nobody's attendance/secrets reset when multi-fort landed); every
  other fort uses `tf_<slug>_*`. Per-device state (theme, attendance, secrets found,
  wall-seen marker) is intentionally NOT server-side
