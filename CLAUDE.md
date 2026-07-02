# CLAUDE.md — treefort.lol

Private clubhouse website for Connor (13) and invited friends. Built as a gift by
Michael. Bart Simpson's treehouse as a website: old-internet energy, deadpan absurdism,
no engagement mechanics of any kind. Currently **built and verified, not yet deployed**
— next milestone is DEPLOY.md, top to bottom.

## Architecture

One Cloudflare Worker + D1 (SQLite) + R2 (media). **Zero dependencies, no build step,
no framework, no npm install.** This is a load-bearing constraint, not an accident —
every page is a single readable file because the 13-year-old owner is meant to read
and mod the source. Do not introduce bundlers, frameworks, libraries, or CDN scripts.

| path | what |
|---|---|
| `src/worker.js` | entire backend: code-gate auth, sessions, wall, dictionary, media, founder ops |
| `schema.sql` | entire database (D1) |
| `public/index.html` | the fort: door theater, bulletin, wall, dictionary, oracle, workshop, pixel dog |
| `public/paint.html` | drawing tool + animation frames (onion skin) |
| `public/kitchen.html` | meme maker (impact text, draw layer, remix-from-wall) |
| `public/gifmachine.html` | client-side GIF89a encoder — **hand-written LZW, do not replace with a library** |
| `test/doortest.mjs` | full API integration test, stubbed D1/R2 — `node test/doortest.mjs` |
| `DEPLOY.md` | the runbook (account → wrangler → D1/R2 → setup call → Porkbun nameservers) |

## Access model (the whole point — do not "improve" it)

- No accounts, no emails, no passwords-per-person, no recovery flows
- One shared FORT CODE opens the door; one FOUNDER CODE (Connor's; Michael has a copy
  as backstop) unlocks founder powers: change code, delete posts, rename fort/dog,
  dictionary status chips, roster
- Sessions: signed HTTP-only cookie (HMAC, 90d). `config.gen` is a generation counter —
  changing the fort code bumps it and invalidates every session (founder re-keyed in
  the same response)
- Names are honor-system. `CONNOR` and `JAMIE` (little brother, 9) get bespoke door
  greetings. Wrong code x5 per IP → 10-minute cooldown

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
  "the staff" and "the management." He files perimeter reports.
- PATRICIA is the poster (Miss Fort 1944, a poodle). DALE won't discuss the calendar shoot.
- Secrets: footer advertises 3; truth is 7 (locked-door knocks, moon x3, typing the
  dog's name, oracle "what is the fort", defining "fort" in the dictionary, full
  16-color palette in paint, wordless meme). Counter overflow (e.g. 7/3) is intentional.
- Attendance counts total days ever, NEVER consecutive streaks ("the fort is not your boss")
- Every page opens with a source-code letter to Connor. Update it when rooms change.

## Commands

```bash
node test/doortest.mjs                                  # API integration test (offline, stubbed)
wrangler dev                                            # local dev (needs D1 id in wrangler.toml)
wrangler deploy                                         # ship
wrangler d1 execute fort --file schema.sql --remote     # apply schema
wrangler d1 export fort --remote --output backup.sql    # backup
```

Client pages have no test harness; changes there = manual check in browser + `node --check`
on the extracted script block.

## Verified before handoff

- doortest: 40+ assertions (setup sealing, knock/cooldown, sessions, wall/replies/
  tombstones, upload validation, dict, founder powers, lock-change gen invalidation,
  rate limits)
- GIF encoder: byte-exact decode roundtrip vs PIL through all LZW code-width
  transitions (9→12 bits) and a 4096-entry dictionary reset
- `wrangler.toml` still contains `PASTE_YOUR_D1_ID_HERE` — intentional; filled during deploy

## Known deliberate quirks

- `/api/setup` founds the fort exactly once, then returns 403 forever (break-glass
  reset procedure is in DEPLOY.md)
- In-memory rate-limit buckets are per-isolate best-effort — fine for five kids
- GIF palette is fixed 3-3-2 (256 colors), no dithering: crunchy on purpose
- localStorage keys are namespaced `tf_*`; per-device state (theme, attendance,
  secrets found, wall-seen marker) is intentionally NOT server-side
