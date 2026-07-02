# DEPLOY.md — treefort v2 runbook (from zero)

Michael's copy. Cut-paste top to bottom. ~30 minutes including DNS wait.
After step 9 you are hands-off infrastructure, as designed.

## 0. Prereqs

- Node 18+ on your Mac (`node -v`)
- This repo pushed to GitHub (`never-nude/treefort`) — or deploy straight from the folder; wrangler doesn't care

## 1. Cloudflare account

1. https://dash.cloudflare.com/sign-up — free plan, your email
2. Verify the email. That's it, no card needed yet.

> **R2 note (the one asterisk):** enabling R2 requires putting a payment method on file
> even though the free tier is $0 for 10 GB storage / 1M ops per month. Five kids posting
> memes will use a fraction of that. Expected monthly bill: **$0.00**.
> In the dashboard: **R2 → Enable R2** (do this once, before step 4).

## 2. Wrangler CLI

```bash
npm install -g wrangler
wrangler login        # opens browser, click allow
wrangler whoami       # sanity check
```

## 3. Create the database

```bash
cd /path/to/treefort
wrangler d1 create fort
```

Copy the `database_id` from the output and paste it into `wrangler.toml`
(replacing `PASTE_YOUR_D1_ID_HERE`), then load the schema:

```bash
wrangler d1 execute fort --file schema.sql --remote
```

## 4. Create the media bucket

```bash
wrangler r2 bucket create fort-media
```

## 5. Session secret

```bash
openssl rand -hex 32 | wrangler secret put SESSION_SECRET
```

## 6. First deploy (workers.dev, before the domain)

```bash
wrangler deploy
```

Output ends with a URL like `https://treefort.<your-subdomain>.workers.dev`. Open it —
you should see the door. It will refuse everyone, because the fort isn't founded yet.

## 7. Found the fort (one-time, then the route seals itself forever)

Pick two codes. FORT CODE is the one Connor hands out (4+ chars). FOUNDER CODE is the
key to everything (6+, treat it like a dragon treats gold). Then:

```bash
curl -X POST https://treefort.<your-subdomain>.workers.dev/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"fort_code":"PICK-ONE","founder_code":"PICK-ANOTHER"}'
```

Expected: `{"ok":true,"note":"the fort is founded. this route is now sealed forever."}`

Write the founder code on the DEED. By hand. Nowhere digital.

## 8. Smoke test (2 minutes)

- [ ] Open the workers.dev URL → door boots → wrong code gets mocked
- [ ] 5 wrong codes → cooldown with countdown
- [ ] Right code + a name → you're in; bulletin, dog, oracle all live
- [ ] Post text to the Wall; reply to it
- [ ] Founder code + any name → Workshop shows FOUNDER PAPERWORK; delete your test post → tombstone
- [ ] PAINT: draw, post to wall
- [ ] PAINT: 2+ frames → SEND TO GIF MACHINE → MAKE THE GIF → post
- [ ] Phone check: everything again on your phone

## 9. The domain

1. Cloudflare dashboard → **Add a site** → `treefort.lol` → Free plan
2. Cloudflare shows you two nameservers (like `ada.ns.cloudflare.com` / `bob.ns.cloudflare.com`)
3. Porkbun → treefort.lol → **Nameservers** → replace with those two (registrar stays Porkbun; only DNS moves)
4. Wait for Cloudflare to email "treefort.lol is active" (minutes to a couple hours)
5. Uncomment the `routes` block in `wrangler.toml`, then:

```bash
wrangler deploy
```

6. https://treefort.lol → the door. HTTPS is automatic.

## 10. Ops (all of it)

| thing | how |
|---|---|
| change the fort code | Connor does it in the Workshop (or you, with the founder code) |
| delete a post | founder session → remove button on the wall |
| Connor loses fort code | he has the founder code; Workshop → change the locks |
| founder code lost entirely | break-glass below |
| backup (optional, monthly-ish) | `wrangler d1 export fort --remote --output backup-$(date +%F).sql` — media stays in R2 |
| costs | $0/mo at friend-group scale; Workers free tier is 100k requests/day |
| updates | edit files → `wrangler deploy` (or wire the repo to Workers Builds for push-to-deploy) |

### Break-glass: reset codes if the founder code itself is lost

```bash
# 1) get the salt
wrangler d1 execute fort --remote --command "SELECT salt FROM config"
# 2) hash new codes with it (uppercase the code!)
node -e 'const c=require("crypto");console.log(c.createHash("sha256").update(process.argv[1]+process.argv[2].toUpperCase()).digest("hex"))' SALT_HERE NEW-FOUNDER-CODE
node -e 'const c=require("crypto");console.log(c.createHash("sha256").update(process.argv[1]+process.argv[2].toUpperCase()).digest("hex"))' SALT_HERE NEW-FORT-CODE
# 3) write them + change the locks (gen bump logs everyone out)
wrangler d1 execute fort --remote --command "UPDATE config SET founder_hash='HASH1', fort_hash='HASH2', gen=gen+1"
```

## What was verified before shipping

- Full API integration test (node, stubbed D1/R2): 40+ assertions — knock, cooldown,
  sessions, wall, replies, tombstones, upload sniffing + caps, dictionary, founder
  powers, lock-change generation invalidation, rate limits
- GIF encoder: byte-exact decode roundtrip (PIL) through all LZW code-width
  transitions and a full dictionary reset
- All page scripts pass `node --check`

The quiet safety layer (client canvas re-encode strips EXIF/GPS; media served only with
a valid session; no third-party anything) is in the code, not in a settings page.
Nothing to operate.
