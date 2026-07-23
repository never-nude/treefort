/* seed-demo.mjs — furnishes the model home.
   node scripts/seed-demo.mjs local    -> seeds wrangler's local D1/R2 (for testing)
   node scripts/seed-demo.mjs remote   -> seeds production (run once, after review)

   zero dependencies, like everything else here. the GIFs are hand-rolled
   GIF89a — pixels pushed one at a time through an uncompressed LZW stream,
   which is exactly the energy the model home deserves.

   what it makes:
     - the fort:      the_model_home ("The Model Home"), staff pigeon BRENDA
     - two members:   CURATOR (founder; knock printed ONCE below)
                      GUEST   (shared demo identity; its code is random and
                               thrown away — nobody knocks as GUEST, the
                               /demo door mints their session directly)
     - furniture:     posts, self-replies, dictionary terms, one cursed
                      prophecy, and five GIFs (paint, kitchen, gif machine)
   re-running it re-furnishes from scratch (deletes ONLY the_model_home rows). */

import { createHash, randomBytes } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MODE = process.argv[2];
if (MODE !== 'local' && MODE !== 'remote') {
  console.error('usage: node scripts/seed-demo.mjs local|remote');
  process.exit(1);
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'scripts', '.seed-out');
mkdirSync(OUT, { recursive: true });

/* ---- the worker's own hashing, reproduced exactly ---- */
const sha256hex = s => createHash('sha256').update(s).digest('hex');
const hashCode = (salt, code) => sha256hex(salt + code.trim().toUpperCase());
const randomSalt = () => randomBytes(16).toString('hex');
// same honest alphabet as saplings: no 0/O, 1/I/L, no U
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const friendlyCode = () => 'HOME-' + [...randomBytes(8)].map(b => ALPHABET[b % ALPHABET.length]).join('');

/* ================= GIF89a, by hand =================
   fixed 16-color palette; uncompressed LZW (a CLEAR code every 14 literals
   keeps the code table from ever learning anything, much like the pigeon). */
const PALETTE = [
  [0x14, 0x10, 0x09], // 0 fort night
  [0xc9, 0xbd, 0xa3], // 1 fort paper
  [0x9e, 0xe4, 0x93], // 2 fort green
  [0xe8, 0x6a, 0x17], // 3 orange
  [0xf2, 0xc1, 0x4e], // 4 gold
  [0x8a, 0x3b, 0x62], // 5 dusk purple
  [0x2e, 0x59, 0x8c], // 6 dusk blue
  [0xd9, 0x4f, 0x3d], // 7 red
  [0x8d, 0x8d, 0x8d], // 8 pigeon grey
  [0xc4, 0xc4, 0xc4], // 9 pigeon lighter
  [0x3a, 0x2f, 0x18], // 10 fort trim
  [0x1d, 0x15, 0x08], // 11 fort deep
  [0xff, 0xff, 0xff], // 12 white
  [0x00, 0x00, 0x00], // 13 black
  [0x55, 0x7a, 0x3a], // 14 wrong green (for suns)
  [0xe0, 0x9a, 0xb8]  // 15 pink
];

function lzwEncode(pixels) {
  // min code size 4 -> clear=16, eoi=17. emit CLEAR, then <=14 literals, repeat.
  const out = [];
  let bitBuf = 0, bitCnt = 0;
  const push = code => {
    bitBuf |= code << bitCnt; bitCnt += 5;
    while (bitCnt >= 8) { out.push(bitBuf & 0xff); bitBuf >>= 8; bitCnt -= 8; }
  };
  push(16);
  let run = 0;
  for (const p of pixels) {
    if (run === 14) { push(16); run = 0; }
    push(p & 0x0f); run++;
  }
  push(17);
  if (bitCnt > 0) out.push(bitBuf & 0xff);
  return out;
}

function gif(w, h, frames, delayCs = 40) {
  const bytes = [];
  const S = s => { for (const c of s) bytes.push(c.charCodeAt(0)); };
  const B = (...a) => bytes.push(...a);
  const U16 = n => B(n & 0xff, (n >> 8) & 0xff);
  S('GIF89a'); U16(w); U16(h);
  B(0xf3, 0, 0);                       // global color table, 16 colors
  for (const [r, g, b] of PALETTE) B(r, g, b);
  if (frames.length > 1) {             // loop forever (the pigeon insists)
    B(0x21, 0xff, 0x0b); S('NETSCAPE2.0'); B(0x03, 0x01); U16(0); B(0x00);
  }
  for (const px of frames) {
    B(0x21, 0xf9, 0x04, 0x04); U16(frames.length > 1 ? delayCs : 0); B(0x00, 0x00);
    B(0x2c); U16(0); U16(0); U16(w); U16(h); B(0x00);
    B(0x04);                           // LZW min code size
    const data = lzwEncode(px);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      B(chunk.length, ...chunk);
    }
    B(0x00);
  }
  B(0x3b);
  return Buffer.from(bytes);
}

/* ---- a canvas made of honesty ---- */
function canvas(w, h, bg = 0) { return { w, h, px: new Uint8Array(w * h).fill(bg) }; }
function rect(c, x, y, w, h, col) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++)
    if (i >= 0 && i < c.w && j >= 0 && j < c.h) c.px[j * c.w + i] = col;
}
/* 3x5 font. every letter earned its place. */
const FONT = {
  A: '111101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '111100101101111', H: '101101111101101',
  I: '111010010010111', J: '001001001101111', K: '101110100110101', L: '100100100100111',
  M: '101111111101101', N: '101111111111101', O: '111101101101111', P: '111101111100100',
  Q: '111101101111001', R: '111101110110101', S: '111100111001111', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', ' ': '000000000000000', '.': '000000000000010',
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111', "'": '010010000000000', '!': '010010010000010'
};
function text(c, str, x, y, scale, col) {
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++)
      if (glyph[j * 3 + i] === '1') rect(c, cx + i * scale, y + j * scale, scale, scale, col);
    cx += 4 * scale;
  }
}
const centered = (c, str, y, scale, col) =>
  text(c, str, Math.floor((c.w - (str.length * 4 - 1) * scale) / 2), y, scale, col);

/* ================= the furniture itself ================= */

// PAINT №1 — "the sunset, from memory"
function paintSunset() {
  const c = canvas(120, 90);
  rect(c, 0, 0, 120, 30, 5); rect(c, 0, 30, 120, 20, 3); rect(c, 0, 50, 120, 14, 4);
  rect(c, 0, 64, 120, 26, 6);                          // the sea. or a field. unclear.
  rect(c, 48, 34, 24, 24, 14);                         // the sun, which memory made green
  rect(c, 20, 70, 4, 12, 13); rect(c, 30, 74, 4, 8, 13); // figures? posts? unresolved.
  return gif(120, 90, [c.px]);
}

// PAINT №2 — "portrait of BRENDA (essence)"
function paintBrenda() {
  const c = canvas(120, 90, 11);
  rect(c, 40, 30, 40, 34, 8);                          // the body politic
  rect(c, 66, 18, 22, 20, 8); rect(c, 84, 24, 8, 6, 3); // head, beak
  rect(c, 74, 22, 5, 5, 13); rect(c, 76, 23, 2, 2, 12); // the eye. it has seen.
  rect(c, 46, 40, 20, 14, 9);                          // wing (approximate)
  rect(c, 50, 64, 4, 10, 3); rect(c, 62, 64, 4, 10, 3); // legs, regrettably
  text(c, 'BRENDA', 8, 8, 2, 1);
  return gif(120, 90, [c.px]);
}

// GIF MACHINE — the campfire (3 frames, flickers responsibly)
function gifCampfire() {
  const frames = [];
  for (let f = 0; f < 3; f++) {
    const c = canvas(90, 90);
    rect(c, 25, 66, 40, 8, 10);                        // logs
    rect(c, 33, 40 + f * 3, 24, 26 - f * 3, 3);        // fire, outer opinion
    rect(c, 39, 48 + f * 2, 12, 18 - f * 2, 4);        // fire, inner truth
    if (f === 1) rect(c, 43, 30, 4, 6, 8);             // smoke (scheduled)
    frames.push(c.px);
  }
  return gif(90, 90, frames, 25);
}

// KITCHEN №1 — a meme about patience
function memePigeon() {
  const c = canvas(180, 120, 6);
  rect(c, 70, 48, 40, 30, 8); rect(c, 97, 38, 20, 16, 8); rect(c, 113, 43, 7, 5, 3);
  rect(c, 103, 41, 4, 4, 13);
  centered(c, 'ONE DAY', 10, 3, 12);
  centered(c, 'THE PIGEON WILL SPEAK', 98, 2, 12);
  return gif(180, 120, [c.px]);
}

// KITCHEN №2 — a meme about the fine-ness of things
function memeFine() {
  const c = canvas(180, 120, 3);
  rect(c, 30, 66, 120, 44, 11);                        // a room, broadly
  rect(c, 42, 78, 14, 22, 4); rect(c, 124, 78, 14, 22, 4); // fires (decorative)
  centered(c, 'THIS IS', 12, 3, 12);
  centered(c, 'FINE ENOUGH', 38, 3, 12);
  return gif(180, 120, [c.px]);
}

/* ================= identities ================= */
const salt = randomSalt();
const curatorCode = friendlyCode();
const guestCode = randomBytes(24).toString('hex');   // printed nowhere. knocks never.
const curatorHash = hashCode(salt, curatorCode);
const guestHash = hashCode(salt, guestCode);
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

/* ================= the media ================= */
const MEDIA = [
  ['m/homepaint1', paintSunset()],
  ['m/homepaint2', paintBrenda()],
  ['m/homegif1', gifCampfire()],
  ['m/homememe1', memePigeon()],
  ['m/homememe2', memeFine()]
];

/* ================= the wall =================
   oldest first; ids ascend so the wall (id DESC) reads newest at top.
   authorship IS the wipe boundary: everything here is CURATOR, forever. */
const POSTS = [
  { type: 'text', days: 21, text:
    "welcome to the model home. every fort on this tree is private except this one, which we keep furnished and show to strangers. you are the stranger. touch anything. the couch is load-bearing." },
  { type: 'painting', days: 19, media: 'm/homepaint1', text:
    "painted the sunset from memory. memory made the sun green. i stand by memory." },
  { type: 'text', days: 17, text:
    "HOUSE RULES OF THE MODEL HOME: 1. there is no rule one. 2. the dishwasher is decorative. 3. BRENDA outranks you. 4. whatever you make here stops having happened at 3 AM. this is a mercy." },
  { type: 'gif', days: 14, media: 'm/homegif1', text:
    "fed three frames into the gif machine. it returned a campfire that never goes out and never warms anything. the machine does not explain itself." },
  { type: 'meme', days: 12, media: 'm/homememe1', text:
    "made this in the kitchen. it is about BRENDA. she has not commented, which is the point of the meme." },
  { type: 'text', days: 10, text:
    "CURSED PROPHECY No. 7: a visitor will arrive claiming to be JUST LOOKING. within the hour they will make a gif of a spinning hot dog. they will show no one. they will think about it for days. the prophecy is always right.",
    replies: [
      "update: it happened. it was not even the same visitor. the prophecy counts it.",
      "the prophecy has never missed. the prophecy does not know what a miss is."
    ] },
  { type: 'painting', days: 7, media: 'm/homepaint2', text:
    "portrait of BRENDA. she declined to sit still, so this is her essence rather than her likeness. the essence has been certified." },
  { type: 'text', days: 5, text:
    "i have argued both sides of every argument on this wall and i have never once lost.",
    replies: [
      "counterpoint: you have never won either.",
      "the management asks you both to keep it down. the management is also me. it is quiet here at night."
    ] },
  { type: 'meme', days: 3, media: 'm/homememe2', text:
    "kitchen output, batch two. the fires are decorative, like the dishwasher. everything here is fine enough." },
  { type: 'text', days: 1, text:
    "GUEST BOOK: if you can read this, you are the guest. the wall is yours — write on it, paint on it, cook something in the kitchen. at 3 AM the broom comes for everything you made, and the model home forgets you fondly." }
];

const TERMS = [
  { term: 'LOAD-BEARING', def: 'adjective. do not touch it. everything in the model home is load-bearing, including the jokes.', ex: 'the couch is load-bearing.', status: 'CERTIFIED', days: 20 },
  { term: 'MODEL HOME', def: 'a house pretending to be lived in. the pretending is the living.', ex: '', status: 'CERTIFIED', days: 18 },
  { term: 'BRENDA', def: 'staff. species: pigeon. duties: judgment.', ex: 'BRENDA has seen your gif and formed a view.', status: 'CERTIFIED', days: 16 },
  { term: '3 AM', def: 'when the broom comes. not a metaphor. also a metaphor.', ex: "see you at 3 AM. you won't.", status: '', days: 2 }
];

/* ================= SQL ================= */
let sql = `-- seed-demo: the model home, furnished. generated ${new Date().toISOString()}
-- touches ONLY fort_id='the_model_home'. re-runnable.
DELETE FROM replies WHERE fort_id='the_model_home';
DELETE FROM posts WHERE fort_id='the_model_home';
DELETE FROM terms WHERE fort_id='the_model_home';
DELETE FROM agreements WHERE fort_id='the_model_home';
DELETE FROM visits WHERE fort_id='the_model_home';
DELETE FROM knock_fails WHERE fort_id='the_model_home';
DELETE FROM members WHERE fort_id='the_model_home';
DELETE FROM forts WHERE id='the_model_home';
INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at, companion_kind)
  VALUES ('the_model_home', 'the_model_home', 'The Model Home', 'BRENDA', 1, ${q(salt)}, ${NOW - 30 * DAY}, 'pigeon');
INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at)
  VALUES ('the_model_home', 'CURATOR', ${q(curatorHash)}, 1, ${NOW - 30 * DAY});
-- GUEST "already has" a spare key (hash of random junk, printed nowhere):
-- guests can't cut spares, so the fort must never nag them to. paperwork.
INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at, spare_hash, spare_issued_at)
  VALUES ('the_model_home', 'GUEST', ${q(guestHash)}, 0, ${NOW - 30 * DAY}, ${q(sha256hex(randomBytes(24).toString('hex')))}, ${NOW - 30 * DAY});
INSERT INTO agreements (fort_id, handle, rules_version, agreed_at) VALUES ('the_model_home', 'CURATOR', 1, ${NOW - 30 * DAY});
INSERT INTO agreements (fort_id, handle, rules_version, agreed_at) VALUES ('the_model_home', 'GUEST', 1, ${NOW - 30 * DAY});
`;
for (const p of POSTS) {
  const t = NOW - p.days * DAY;   // one post per day-offset, so `created` is a unique handle for replies below
  sql += `INSERT INTO posts (fort_id, author, type, text, media_key, created, deleted) VALUES ('the_model_home', 'CURATOR', ${q(p.type)}, ${q(p.text)}, ${p.media ? q(p.media) : 'NULL'}, ${t}, 0);\n`;
  for (const [i, r] of (p.replies || []).entries()) {
    sql += `INSERT INTO replies (fort_id, post_id, author, text, created) VALUES ('the_model_home', (SELECT id FROM posts WHERE fort_id='the_model_home' AND created=${t}), 'CURATOR', ${q(r)}, ${t + (i + 1) * 3600});\n`;
  }
}
for (const tm of TERMS) {
  sql += `INSERT INTO terms (fort_id, term, def, example, author, status, created) VALUES ('the_model_home', ${q(tm.term)}, ${q(tm.def)}, ${tm.ex ? q(tm.ex) : 'NULL'}, 'CURATOR', ${q(tm.status)}, ${NOW - tm.days * DAY});\n`;
}

const sqlPath = join(OUT, 'seed.sql');
writeFileSync(sqlPath, sql);

/* ================= wrangler does the driving ================= */
const flag = MODE === 'remote' ? '--remote' : '--local';
const run = args => {
  console.log('  $ wrangler ' + args.join(' '));
  execFileSync('npx', ['wrangler', ...args], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
};
console.log(`\nfurnishing the model home (${MODE})...`);
run(['d1', 'execute', 'fort', flag, '-y', '--file', sqlPath]);
for (const [key, buf] of MEDIA) {
  const p = join(OUT, key.replace('/', '_') + '.gif');
  writeFileSync(p, buf);
  run(['r2', 'object', 'put', `fort-media/${key}`, flag, '--file', p, '--content-type', 'image/gif']);
}
console.log(`
the model home is furnished.
  fort:     /the_model_home/   (guests arrive via /demo)
  CURATOR's knock (shown once, write it on paper): ${curatorCode}
  GUEST's code: random, discarded. nobody knocks as GUEST — /demo mints the session.
`);
