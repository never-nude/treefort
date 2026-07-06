# treefort.lol

a private clubhouse network on the internet. members only. you know if you're a member.

- no accounts. no emails. no algorithm. no likes. no streaks. no notifications.
  no ads. no analytics. no AI. no narcs.
- the fort URL plus your knock opens the door. founders run their own fort.
- everything on the wall has a name on it. the management can remove things.
  the management is a dog.

## what's in the box

| path | what |
|---|---|
| `src/worker.js` | the whole backend. door, wall, dictionary, media, paperwork |
| `schema.sql` | the whole database |
| `migrations/0001_multi_fort_foundation.sql` | live migration from one fort to many |
| `public/index.html` | the fort: door, bulletin, wall, dictionary, oracle, workshop, dog |
| `public/paint.html` | the art room (spray can is load-bearing) |
| `public/kitchen.html` | meme kitchen (impact font is a food group) |
| `public/gifmachine.html` | gif machine (hand-built GIF89a encoder, no outside contractors) |
| `DEPLOY.md` | the runbook. cut-paste top to bottom |

## stack

one Cloudflare Worker + D1 (sqlite) + R2 (media). zero dependencies —
no npm install, no build step, no framework. the fort does not outsource.

current forts:

- The Lookout: `/the_lookout/`, founder `CONNOR`
- Base Camp: `/base_camp/`, founder `KUSHMAN`

## for the founder

open the source of any page. there's a letter for you at the top.
