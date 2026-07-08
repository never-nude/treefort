/* treefort v2 worker — the door, the wall, the paperwork.
   one file. no dependencies. the raccoon council reviewed it. */

'use strict';

const DAY = 86400;
const SESSION_DAYS = 90;
const KNOCK_WINDOW = 600;      // seconds
const KNOCK_LIMIT = 5;         // fails per window -> cooldown
const POST_TEXT_MAX = 2000;
const REPLY_TEXT_MAX = 500;
const IMG_MAX = 4 * 1024 * 1024;
const GIF_MAX = 10 * 1024 * 1024;
const PAGE_SIZE = 20;
const DEFAULT_FORT_SLUG = 'the_lookout';
const RULES_VERSION = 1;       // bump this when the sign changes; everyone re-knocks past it once
const GRANTS_UNUSED_MAX = 5;   // saplings a fort may hold unplanted
const COMPANION_KINDS = ['dog', 'cat', 'fern', 'pigeon', 'moth'];
// names the tree keeps for itself. refused at founding — never numbered, never granted.
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'administrator', 'login', 'logout', 'signin', 'signup', 'climb_down',
  'grove', 'the_grove', 'plant', 'sapling', 'saplings', 'rules', 'rule', 'reports',
  'm', 'media', 'assets', 'static', 'setup', 'seed', 'fort', 'forts', 'treefort', 'www',
  'index', 'root', 'home', 'help', 'about', 'terms', 'tos', 'legal', 'privacy',
  'paint', 'kitchen', 'gifmachine', 'handbook', 'door', 'wall', 'dict', 'dictionary',
  'workshop', 'management', 'staff', 'mod', 'mods', 'dale', 'patricia',
  'null', 'undefined'
]);
// sapling alphabet skips lookalikes (0/O, 1/I/L) and U — readable over a lunch table
const SAPLING_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const ROOM_ASSETS = new Map([
  ['/', '/index.html'],
  ['/index.html', '/index.html'],
  ['/paint', '/paint.html'],
  ['/paint.html', '/paint.html'],
  ['/kitchen', '/kitchen.html'],
  ['/kitchen.html', '/kitchen.html'],
  ['/gifmachine', '/gifmachine.html'],
  ['/gifmachine.html', '/gifmachine.html'],
  ['/handbook', '/handbook.html'],
  ['/handbook.html', '/handbook.html']
]);

/* ---------------- crypto helpers ---------------- */
const enc = new TextEncoder();

async function sha256hex(str) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function randKey(prefix) {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return prefix + Date.now().toString(36) + [...a].map(b => b.toString(36)).join('').slice(0, 12);
}

/* ---------------- session cookie ---------------- */
async function makeSession(env, fort, role, name) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * DAY;
  const body = ['v2', fort.id, fort.gen, role, encodeURIComponent(name), exp].join('.');
  const sig = await hmacHex(env.SESSION_SECRET, body);
  return body + '.' + sig;
}
async function readSession(env, request, fort) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)fort_session=([^;]+)/);
  if (!m) return null;
  const raw = m[1];
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const body = raw.slice(0, i), sig = raw.slice(i + 1);
  const expect = await hmacHex(env.SESSION_SECRET, body);
  if (!timingSafeEq(sig, expect)) return null;
  const [v, fortId, gen, role, nameEnc, exp] = body.split('.');
  if (v !== 'v2') return null;
  if (fortId !== fort.id) return null;
  if (parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return null;
  if (parseInt(gen, 10) !== fort.gen) return null;   // the locks changed
  const name = decodeURIComponent(nameEnc);
  const member = await memberByHandle(env, fort.id, name);
  if (!member || member.revoked) return null;   // kicked out of the tree = the cookie means nothing
  // sessions issued before the knock last changed are dead — a thief's stolen
  // session does not outlive the re-keying. issued-at is derived as exp minus
  // the session length, which means: DO NOT change SESSION_DAYS while tokens
  // are in flight — old tokens would mis-derive by the delta for up to 90 days.
  // if it must change, bump the token version ('v2' above) so old tokens die.
  const issuedAt = parseInt(exp, 10) - SESSION_DAYS * DAY;
  if (member.code_changed_at && issuedAt < member.code_changed_at) return null;
  return { fort_id: fort.id, fort_slug: fort.slug, role: member.is_founder ? 'founder' : 'member', name, gen: parseInt(gen, 10),
    spare_ready: !!member.spare_issued_at };
}
function sessionCookie(token, fort) {
  return `fort_session=${token}; Max-Age=${SESSION_DAYS * DAY}; Path=/${fort.slug}; HttpOnly; Secure; SameSite=Lax`;
}
// Max-Age=0 tells the browser to forget the cookie. that is the whole of logging out —
// no name is stored anywhere, so leaving is just the door forgetting your face on purpose.
function clearSessionCookie(fort) {
  return `fort_session=; Max-Age=0; Path=/${fort.slug}; HttpOnly; Secure; SameSite=Lax`;
}
// the single-fort era set its cookie at Path=/ with a 90-day fuse. it outranks
// nothing, but some clients would keep PRESENTING it first and 401 forever.
// every knock and climb-down also snuffs it. harmless once, gone after that.
const LEGACY_ROOT_COOKIE_CLEAR = 'fort_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax';
function withLegacyCookieClear(res) {
  res.headers.append('Set-Cookie', LEGACY_ROOT_COOKIE_CLEAR);
  return res;
}
function handleLogout(fort) {
  return withLegacyCookieClear(json({ ok: true, note: 'you climbed down. the ladder is still there.' },
    200, { 'Set-Cookie': clearSessionCookie(fort) }));
}

/* ---------------- small utils ---------------- */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers
    }
  });
}

/* security headers for HTML. the CSP allows this site's own inline script/style
   (every page is one hand-written file — that's the whole architecture) and
   blocks EVERYTHING external, which turns the "no third-party scripts" house
   rule from a promise into a law the browser enforces. */
const HTML_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};
function withHtmlHeaders(res) {
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('text/html')) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(HTML_SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}
const nope = (msg, status = 400) => json({ ok: false, error: msg }, status);

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().toUpperCase().replace(/[^A-Z0-9 '\-_]/g, '').slice(0, 20).trim();
  return name.length ? name : null;
}
function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\r/g, '').trim().slice(0, max);
}
async function readJson(request) {
  try { return await request.json(); } catch (e) { return null; }
}
async function getConfig(env) {
  return await env.DB.prepare('SELECT * FROM config WHERE id=1').first();
}
function now() { return Math.floor(Date.now() / 1000); }

function normalizeFortSlug(displayNameOrSlug) {
  if (typeof displayNameOrSlug !== 'string') return null;
  const slug = displayNameOrSlug.trim().replace(/\s+/g, '_').toLowerCase();
  return /^[a-z0-9_]+$/.test(slug) ? slug : null;
}
async function getFortBySlug(env, slug) {
  const s = normalizeFortSlug(slug);
  if (!s) return null;
  return await env.DB.prepare('SELECT * FROM forts WHERE slug=?').bind(s).first();
}
async function createFort(env, { displayName, slug, founderHandle, founderCode, salt }) {
  const cleanDisplay = cleanText(displayName, 40);
  const normalized = normalizeFortSlug(slug || cleanDisplay);
  if (!cleanDisplay || !normalized) return { ok: false, error: 'a fort needs a clean name and slug.' };
  if (await getFortBySlug(env, normalized)) return { ok: false, error: 'that fort slug is already nailed to a tree.', status: 409 };
  const fortSalt = salt || await randomSalt();
  const t = now();
  await env.DB.prepare(
    'INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).bind(normalized, normalized, cleanDisplay, 'DALE', fortSalt, t).run();
  if (founderHandle && founderCode) {
    const handle = cleanName(founderHandle);
    const code = cleanCode(founderCode);
    if (!handle || code.length < 4) return { ok: false, error: 'founder needs a handle and a 4+ character code.' };
    const h = await hashCode(fortSalt, code);
    await env.DB.prepare(
      'INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at) VALUES (?, ?, ?, 1, ?)'
    ).bind(normalized, handle, h, t).run();
  }
  return { ok: true, fort: await getFortBySlug(env, normalized) };
}
async function randomSalt() {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  return [...saltBytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function requireFortFromRequest(env, request) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  const slug = normalizeFortSlug(parts[0]);
  if (!slug) return null;
  const fort = await getFortBySlug(env, slug);
  if (!fort) return null;
  const rest = '/' + parts.slice(1).join('/');
  return {
    fort,
    requestedSlug: parts[0],
    restPath: rest === '/' && parts.length === 1 ? '/' : rest,
    needsCanonical: parts[0] !== fort.slug
  };
}
function canonicalFortUrl(request, fortCtx) {
  const url = new URL(request.url);
  const path = fortCtx.restPath === '/' ? `/${fortCtx.fort.slug}/` : `/${fortCtx.fort.slug}${fortCtx.restPath}`;
  url.pathname = path;
  return url.toString();
}
function assetRequest(request, assetPath) {
  const url = new URL(request.url);
  url.pathname = assetPath;
  return new Request(url.toString(), request);
}

/* ---------------- members / knocks ----------------
   a knock is one personal code. it hashes to exactly one member, and that member's
   handle is what gets stamped on their posts. no name is ever typed at the door, so
   nobody can wear someone else's name. we store only the hash, never the code. */
function cleanCode(raw) { return (typeof raw === 'string' ? raw : '').trim(); }
async function hashCode(salt, code) { return sha256hex(salt + code.trim().toUpperCase()); }
async function memberByHash(env, fortId, h) {
  return await env.DB.prepare('SELECT * FROM members WHERE fort_id=? AND code_hash=?').bind(fortId, h).first();
}
async function memberByHandle(env, fortId, handle) {
  return await env.DB.prepare('SELECT * FROM members WHERE fort_id=? AND handle=?').bind(fortId, handle).first();
}
// codes must be unique inside a fort. returns the other owner's handle, or null.
async function codeTakenByOther(env, fortId, h, handle) {
  const row = await env.DB.prepare('SELECT handle FROM members WHERE fort_id=? AND code_hash=?').bind(fortId, h).first();
  return row && row.handle !== handle ? row.handle : null;
}

/* ---------------- saplings + founding ----------------
   a sapling is a one-use founding code. the founder who mints it is vouching for
   whoever plants it, and that lineage is permanent record — every fort traces
   back through grants to a root. */
function makeSaplingToken() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const chars = [...a].map(b => SAPLING_ALPHABET[b % SAPLING_ALPHABET.length]);
  return 'SAPLING-' + chars.slice(0, 4).join('') + '-' + chars.slice(4).join('');
}
/* the spare key: same honest alphabet, different lock */
function makeSpareKey() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  const chars = [...a].map(b => SAPLING_ALPHABET[b % SAPLING_ALPHABET.length]);
  return 'SPARE-' + chars.slice(0, 4).join('') + '-' + chars.slice(4).join('');
}
function normalizeSpare(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const core = t.startsWith('SPARE') ? t.slice(5) : t;
  return core.length === 8 ? core : null;
}
async function spareHash(env, fortSalt, raw) {
  const core = normalizeSpare(raw);
  if (!core) return null;
  return sha256hex(fortSalt + 'spare:' + core);
}
function normalizeSapling(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return t.length >= 8 ? t : null;   // 'SAPLINGXXXXXXXX' or bare 'XXXXXXXX' both land here
}
async function saplingHash(env, raw) {
  const t = normalizeSapling(raw);
  if (!t) return null;
  // tolerate the word SAPLING being typed or not — hash only the 8 meaningful chars
  const core = t.startsWith('SAPLING') ? t.slice(7) : t;
  if (core.length !== 8) return null;
  return sha256hex(env.SESSION_SECRET + 'sapling:' + core);
}

/* fort display names: printable ASCII only (kills zero-width/bidi spoofing), 2-18 chars */
function cleanFortName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18).trim();
  return name.length >= 2 ? name : null;
}
/* the registry: find what this name gets. free -> itself. taken -> lowest free "Name N". */
async function registryCheck(env, wantedName) {
  const name = cleanFortName(wantedName);
  if (!name) return { bad: 'a fort needs a name. 2 to 18 characters. name it like it\'s going on a water tower.' };
  const baseSlug = normalizeFortSlug(name);
  if (!baseSlug || !/[a-z]/.test(baseSlug)) return { bad: 'that name is all punctuation. the water tower painters refuse.' };
  if (RESERVED_SLUGS.has(baseSlug)) return { reserved: true };
  if (!(await getFortBySlug(env, baseSlug))) return { free: true, name, slug: baseSlug };
  for (let n = 2; n <= 50; n++) {
    const slug = `${baseSlug}_${n}`;
    if (RESERVED_SLUGS.has(slug)) continue;
    if (!(await getFortBySlug(env, slug))) {
      return { taken: true, issued: { name: `${name} ${n}`, slug } };
    }
  }
  return { bad: 'the registry ran out of numbers. that name is TOO popular. pick another.' };
}

/* the management's smoke signals: operator-only email, never kids. fails silently —
   the fort must never break because the post office is closed. */
async function tellTheManagement(env, subject, text) {
  try {
    if (!env.MAIL || !env.MANAGEMENT_EMAIL) return;
    await env.MAIL.send({
      to: env.MANAGEMENT_EMAIL,
      from: { email: 'management@treefort.lol', name: 'the management' },
      subject: subject.replace(/[\r\n]/g, ' ').slice(0, 120),
      text: text.replace(/\r/g, '').slice(0, 2000)
    });
  } catch (e) {
    console.error('smoke signal failed:', e.message);
  }
}

/* magic bytes: the only art criticism the fort performs */
function sniffImage(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/* best-effort per-isolate rate limit (five kids, not the mongol horde) */
const buckets = new Map();
function rateLimited(key, limit, windowSec) {
  const t = now();
  const b = buckets.get(key);
  if (!b || t - b.start > windowSec) { buckets.set(key, { start: t, n: 1 }); return false; }
  b.n++;
  return b.n > limit;
}

/* ---------------- route handlers ---------------- */

async function handleSetup(env, request) {
  const existing = await getConfig(env);
  if (existing) return nope('the fort is already founded. there is no second founding.', 403);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const fortCode = cleanText(body.fort_code, 64);
  const founderCode = cleanText(body.founder_code, 64);
  if (fortCode.length < 4 || founderCode.length < 6) {
    return nope('fort code needs 4+ characters, founder code needs 6+. security theater has SOME standards.');
  }
  if (fortCode.toUpperCase() === founderCode.toUpperCase()) {
    return nope('the founder code cannot equal the fort code. separation of powers.');
  }
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = [...saltBytes].map(b => b.toString(16).padStart(2, '0')).join('');
  const fortHash = await sha256hex(salt + fortCode.toUpperCase());
  const founderHash = await sha256hex(salt + founderCode.toUpperCase());
  await env.DB.prepare(
    'INSERT INTO config (id, gen, salt, fort_hash, founder_hash) VALUES (1, 1, ?, ?, ?)'
  ).bind(salt, fortHash, founderHash).run();
  return json({ ok: true, note: 'the fort is founded. this route is now sealed forever.' });
}

async function handleKnock(env, request, fort, ip) {
  // cooldown check
  const t = now();
  const fail = await env.DB.prepare('SELECT * FROM knock_fails WHERE fort_id=? AND ip=?').bind(fort.id, ip).first();
  if (fail && t - fail.window_start < KNOCK_WINDOW && fail.fails >= KNOCK_LIMIT) {
    const wait = KNOCK_WINDOW - (t - fail.window_start);
    return json({ ok: false, cooldown: wait, error: 'too many wrong codes. the door needs ' + wait + ' seconds to forget your face.' }, 423);
  }
  const body = await readJson(request);
  if (!body) return nope('json required');
  const code = cleanCode(body.code);
  if (!code) return nope('a knock is one code. that is the whole form.');

  // the code alone decides who you are. no name is typed, so no name can be faked.
  // a revoked member's code is just a wrong code now — the door does not explain itself.
  const h = await hashCode(fort.salt, code);
  const member = await memberByHash(env, fort.id, h);

  if (!member || member.revoked) {
    // wrong knock: count the miss, and never reveal whether any handle exists.
    if (!fail || t - fail.window_start >= KNOCK_WINDOW) {
      await env.DB.prepare(
        'INSERT INTO knock_fails (fort_id, ip, fails, window_start) VALUES (?, ?, 1, ?) ' +
        'ON CONFLICT(fort_id, ip) DO UPDATE SET fails=1, window_start=?'
      ).bind(fort.id, ip, t, t).run();
    } else {
      await env.DB.prepare('UPDATE knock_fails SET fails=fails+1 WHERE fort_id=? AND ip=?').bind(fort.id, ip).run();
    }
    return json({ ok: false, error: 'that knock means nothing to the door. the raccoon council has been notified.' }, 401);
  }

  const role = member.is_founder ? 'founder' : 'member';
  const name = member.handle;

  await env.DB.prepare('DELETE FROM knock_fails WHERE fort_id=? AND ip=?').bind(fort.id, ip).run();
  await env.DB.prepare(
    'INSERT INTO visits (fort_id, name, first_seen, last_seen, knocks) VALUES (?, ?, ?, ?, 1) ' +
    'ON CONFLICT(fort_id, name) DO UPDATE SET last_seen=?, knocks=knocks+1'
  ).bind(fort.id, name, t, t, t).run();

  const agreed = await env.DB.prepare(
    'SELECT id FROM agreements WHERE fort_id=? AND handle=? AND rules_version=?'
  ).bind(fort.id, name, RULES_VERSION).first();

  const token = await makeSession(env, fort, role, name);
  return withLegacyCookieClear(json(
    { ok: true, role, name, fort_name: fort.display_name, fort_slug: fort.slug, dog_name: fort.dog_name,
      companion_kind: fort.companion_kind || 'dog', agreed: !!agreed,
      spare_ready: !!member.spare_issued_at },
    200,
    { 'Set-Cookie': sessionCookie(token, fort) }
  ));
}

async function handleWall(env, request, fort, session) {
  const url = new URL(request.url);
  const before = parseInt(url.searchParams.get('before') || '0', 10);
  let q, binds;
  if (before > 0) {
    q = 'SELECT * FROM posts WHERE fort_id=? AND id < ? ORDER BY id DESC LIMIT ?';
    binds = [fort.id, before, PAGE_SIZE + 1];
  } else {
    q = 'SELECT * FROM posts WHERE fort_id=? ORDER BY id DESC LIMIT ?';
    binds = [fort.id, PAGE_SIZE + 1];
  }
  const rows = (await env.DB.prepare(q).bind(...binds).all()).results || [];
  const more = rows.length > PAGE_SIZE;
  const posts = rows.slice(0, PAGE_SIZE);

  let repliesByPost = {};
  if (posts.length) {
    const ids = posts.map(p => p.id);
    const ph = ids.map(() => '?').join(',');
    const rr = (await env.DB.prepare(
      `SELECT * FROM replies WHERE fort_id=? AND post_id IN (${ph}) ORDER BY id ASC`
    ).bind(fort.id, ...ids).all()).results || [];
    for (const r of rr) (repliesByPost[r.post_id] = repliesByPost[r.post_id] || []).push(
      { id: r.id, author: r.author, text: r.text, created: r.created }
    );
  }
  return json({
    ok: true,
    more,
    posts: posts.map(p => p.deleted
      ? { id: p.id, deleted: true, deleted_by: p.deleted_by || null, author: p.author,
          created: p.created, replies: repliesByPost[p.id] || [] }
      : { id: p.id, author: p.author, type: p.type, text: p.text, media_key: p.media_key,
          created: p.created, deleted: false, replies: repliesByPost[p.id] || [] })
  });
}

async function handlePost(env, request, fort, session) {
  if (rateLimited('post:' + fort.id + ':' + session.name, 8, 60)) {
    return nope('the wall needs a second. it is an old wall.', 429);
  }
  const body = await readJson(request);
  if (!body) return nope('json required');
  const type = ['text', 'image', 'meme', 'painting', 'gif'].includes(body.type) ? body.type : null;
  if (!type) return nope('unknown post type. the wall accepts words and art, not whatever that was.');
  const text = cleanText(body.text, POST_TEXT_MAX);
  const mediaKey = typeof body.media_key === 'string' && /^m\/[a-z0-9]+$/.test(body.media_key) ? body.media_key : null;
  if (type === 'text' && !text) return nope('an empty text post. bold. no.');
  if (type !== 'text' && !mediaKey) return nope('art posts need the art.');
  if (mediaKey) {
    const head = await env.MEDIA.head(mediaKey);
    if (!head) return nope('that media does not exist. spooky. rejected.');
    const mediaFort = head.customMetadata?.fort_id || null;
    if (mediaFort && mediaFort !== fort.id) return nope('that media belongs to another fort.', 403);
    if (!mediaFort && fort.id !== DEFAULT_FORT_SLUG) return nope('that media belongs to another fort.', 403);
  }
  const r = await env.DB.prepare(
    'INSERT INTO posts (fort_id, author, type, text, media_key, created) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(fort.id, session.name, type, text || null, mediaKey, now()).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function handleReply(env, request, fort, session) {
  if (rateLimited('reply:' + fort.id + ':' + session.name, 15, 60)) return nope('easy. the riff will keep.', 429);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const postId = parseInt(body.post_id, 10);
  const text = cleanText(body.text, REPLY_TEXT_MAX);
  if (!postId || !text) return nope('a reply needs a post and some words.');
  const post = await env.DB.prepare('SELECT id, deleted FROM posts WHERE fort_id=? AND id=?').bind(fort.id, postId).first();
  if (!post) return nope('that post does not exist.', 404);
  const r = await env.DB.prepare(
    'INSERT INTO replies (fort_id, post_id, author, text, created) VALUES (?, ?, ?, ?, ?)'
  ).bind(fort.id, postId, session.name, text, now()).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function handleDelete(env, request, fort, session) {
  const body = await readJson(request);
  const postId = parseInt(body && body.post_id, 10);
  if (!postId) return nope('which post?');
  const post = await env.DB.prepare('SELECT author, deleted FROM posts WHERE fort_id=? AND id=?').bind(fort.id, postId).first();
  if (!post) return nope('that post does not exist.', 404);
  if (post.deleted) return json({ ok: true });   // already a tombstone; removing it twice changes nothing
  // your post is yours to remove. everyone else's needs the founder key.
  // either way, the removal is SIGNED — the tombstone says whose hand did it.
  if (session.role !== 'founder' && post.author !== session.name) {
    return nope('your name isn\'t on that one. only the management removes other people\'s posts.', 403);
  }
  await env.DB.prepare(
    'UPDATE posts SET deleted=1, text=NULL, media_key=NULL, deleted_by=? WHERE fort_id=? AND id=?'
  ).bind(session.name, fort.id, postId).run();
  return json({ ok: true, deleted_by: session.name });
}

async function handleUpload(env, request, fort, session) {
  if (rateLimited('upload:' + fort.id + ':' + session.name, 10, 60)) return nope('the darkroom is busy. one minute.', 429);
  const buf = await request.arrayBuffer();
  const type = sniffImage(buf);
  if (!type) return nope('that is not an image the fort recognizes. png, jpeg, gif, webp.', 415);
  const cap = type === 'image/gif' ? GIF_MAX : IMG_MAX;
  if (buf.byteLength > cap) return nope('too big. the fort has one shelf.', 413);
  if (buf.byteLength < 24) return nope('too small to be real.', 400);
  const key = randKey('m/');
  await env.MEDIA.put(key, buf, {
    httpMetadata: { contentType: type },
    customMetadata: { fort_id: fort.id, uploaded_by: session.name }
  });
  return json({ ok: true, media_key: key });
}

async function handleMedia(env, fort, key) {
  if (!/^m\/[a-z0-9]+$/.test(key)) return nope('no.', 400);
  const owner = await env.DB.prepare(
    'SELECT id FROM posts WHERE fort_id=? AND media_key=? AND deleted=0 LIMIT 1'
  ).bind(fort.id, key).first();
  if (!owner) return nope('gone. or never was.', 404);
  const obj = await env.MEDIA.get(key);
  if (!obj) return nope('gone. or never was.', 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function handleDictGet(env, fort) {
  const rows = (await env.DB.prepare('SELECT * FROM terms WHERE fort_id=? ORDER BY id DESC').bind(fort.id).all()).results || [];
  return json({ ok: true, terms: rows });
}
async function handleDictAdd(env, request, fort, session) {
  if (rateLimited('dict:' + fort.id + ':' + session.name, 6, 60)) return nope('the lexicographers need a break.', 429);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const term = cleanText(body.term, 40);
  const def = cleanText(body.def, 500);
  const example = cleanText(body.example, 300);
  if (!term || !def) return nope('a term and a definition. usage example optional but respected.');
  const r = await env.DB.prepare(
    'INSERT INTO terms (fort_id, term, def, example, author, created) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(fort.id, term, def, example || null, session.name, now()).run();
  return json({ ok: true, id: r.meta.last_row_id });
}
async function handleDictStatus(env, request, fort, session) {
  if (session.role !== 'founder') return nope('status chips are a founder power. them\'s the rules.', 403);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const id = parseInt(body.id, 10);
  const status = ['', 'CERTIFIED', 'ON LIFE SUPPORT', 'DECEASED'].includes(body.status) ? body.status : null;
  if (!id || status === null) return nope('unknown status. the fort recognizes three conditions and silence.');
  const died = status === 'DECEASED' ? now() : null;
  await env.DB.prepare('UPDATE terms SET status=?, died=? WHERE fort_id=? AND id=?').bind(status, died, fort.id, id).run();
  return json({ ok: true });
}

// change your OWN knock. prove you know your current code, then set a new one.
// no email, no recovery — if you forget it, a founder resets it for you (below).
async function handleMyCode(env, request, fort, session) {
  // a knock-change asks you to prove your CURRENT knock, which makes this route a
  // guessing oracle for anyone who borrowed a logged-in device. five tries, then tea.
  if (rateLimited('mycode:' + fort.id + ':' + session.name, 5, 600)) {
    return nope('too many tries at the locksmith. come back in ten minutes.', 429);
  }
  const body = await readJson(request);
  if (!body) return nope('json required');
  const cur = cleanCode(body.current_code), next = cleanCode(body.new_code);
  if (next.length < 4) return nope('the new knock needs 4+ characters. the raccoons insist.');
  const me = await memberByHandle(env, fort.id, session.name);
  if (!me) return nope('you are not on the roster. this should be impossible. tell connor.', 409);
  const curH = await hashCode(fort.salt, cur);
  if (!timingSafeEq(curH, me.code_hash)) return nope('that is not your current knock.');
  const nextH = await hashCode(fort.salt, next);
  const clash = await codeTakenByOther(env, fort.id, nextH, session.name);
  if (clash) return nope('someone already knocks like that. pick another.');
  await env.DB.prepare(
    'UPDATE members SET code_hash=?, code_changed_at=? WHERE fort_id=? AND handle=?'
  ).bind(nextH, now(), fort.id, session.name).run();
  // changing the knock kills every old session (including a thief's) —
  // re-key THIS one so the changer doesn't get logged out by their own caution
  const token = await makeSession(env, fort, session.role, session.name);
  return json({ ok: true, note: 'your knock is changed. the door will remember. every other session just forgot you.' },
    200, { 'Set-Cookie': sessionCookie(token, fort) });
}

// founder: put a new person on the roster with a starter code (they change it later).
async function handleMemberAdd(env, request, fort, session) {
  if (session.role !== 'founder') return nope('adding members is founder business.', 403);
  if (rateLimited('memadd:' + fort.id, 20, 3600)) return nope('the roster ink needs to dry. an hour, tops.', 429);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const handle = cleanName(body.handle);
  const code = cleanCode(body.code);
  if (!handle) return nope('a member needs a handle. letters and numbers.');
  if (code.length < 4) return nope('their starter code needs 4+ characters.');
  const existing = await memberByHandle(env, fort.id, handle);
  if (existing && existing.revoked) return nope('that name was kicked out of the tree. it stays out. (the management can undo this, but you are not the management.)', 409);
  if (existing) return nope('someone already goes by ' + handle + '. handles are one to a customer.');
  const h = await hashCode(fort.salt, code);
  if (await codeTakenByOther(env, fort.id, h, handle)) return nope('that code already belongs to someone. pick another.');
  await env.DB.prepare('INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at) VALUES (?, ?, ?, 0, ?)').bind(fort.id, handle, h, now()).run();
  return json({ ok: true, note: handle + ' is on the roster. tell them their code in person.' });
}

/* founder knock-resets are gone on purpose: whoever can reset your knock can BE
   you, and nobody gets to be you — not even the founder. recovery is the spare
   key (below); the double-loss backstop is the management's break-glass. */

// cut a spare key. shown exactly once; only its hash survives here. cutting a
// new one shreds the old one.
async function handleSpareCut(env, request, fort, session) {
  if (rateLimited('sparecut:' + fort.id + ':' + session.name, 3, 3600)) {
    return nope('the key grinder is hot. an hour, tops.', 429);
  }
  const spare = makeSpareKey();
  const h = await spareHash(env, fort.salt, spare);
  await env.DB.prepare(
    'UPDATE members SET spare_hash=?, spare_issued_at=? WHERE fort_id=? AND handle=?'
  ).bind(h, now(), fort.id, session.name).run();
  return json({ ok: true, spare,
    note: 'shown exactly once. write it on paper. hide the paper. the old spare (if any) just became a bookmark.' });
}

// use the spare at the door: lost or stolen knock -> prove yourself with the
// paper -> set a fresh knock. consumes the spare and kills every old session.
async function handleSpareUse(env, request, fort, ip) {
  if (rateLimited('spareuse:' + fort.id + ':' + ip, 5, 600)) {
    return nope('too many tries at the flowerpot. the door needs ten minutes.', 429);
  }
  const body = await readJson(request);
  if (!body) return nope('json required');
  const handle = cleanName(body.handle);
  const newCode = cleanCode(body.new_code);
  if (!handle) return nope('whose spare is it? a handle, please.');
  if (newCode.length < 4) return nope('the new knock needs 4+ characters. the raccoons insist.');
  const member = await memberByHandle(env, fort.id, handle);
  const h = await spareHash(env, fort.salt, body.spare);
  // one error for every failure mode — the door confirms nothing about who exists
  const NOPE = 'that key doesn\'t fit anything here.';
  if (!member || member.revoked || !member.spare_hash || !h) return nope(NOPE, 403);
  if (!timingSafeEq(h, member.spare_hash)) return nope(NOPE, 403);
  const newHash = await hashCode(fort.salt, newCode);
  if (await codeTakenByOther(env, fort.id, newHash, handle)) return nope('someone already knocks like that. pick another.');
  const t = now();
  await env.DB.prepare(
    'UPDATE members SET code_hash=?, spare_hash=NULL, spare_issued_at=NULL, code_changed_at=? WHERE fort_id=? AND handle=?'
  ).bind(newHash, t, fort.id, handle).run();
  // walk in re-keyed: fresh session, old sessions (thief's included) are already dead
  const agreed = await env.DB.prepare(
    'SELECT id FROM agreements WHERE fort_id=? AND handle=? AND rules_version=?'
  ).bind(fort.id, handle, RULES_VERSION).first();
  const token = await makeSession(env, fort, member.is_founder ? 'founder' : 'member', handle);
  return withLegacyCookieClear(json(
    { ok: true, name: handle, role: member.is_founder ? 'founder' : 'member',
      fort_name: fort.display_name, fort_slug: fort.slug, dog_name: fort.dog_name,
      companion_kind: fort.companion_kind || 'dog', agreed: !!agreed, spare_ready: false,
      note: 'the locks are yours again. the fort will cut you a new spare inside.' },
    200, { 'Set-Cookie': sessionCookie(token, fort) }
  ));
}

// founder: who is on the roster (handles only — the door never coughs up a code).
async function handleMembers(env, fort, session) {
  if (session.role !== 'founder') return nope('the roster is founder business.', 403);
  const rows = (await env.DB.prepare(
    'SELECT handle, is_founder, created_at FROM members WHERE fort_id=? ORDER BY is_founder DESC, handle ASC'
  ).bind(fort.id).all()).results || [];
  return json({ ok: true, members: rows });
}

// one-time grandfather seeding, guarded by a worker secret. refuses once any fort exists.
// this creates Connor's Lookout and Michael's Base Camp for fresh installs.
async function handleSeed(env, request) {
  if (!env.SEED_TOKEN) return nope('seeding is not enabled.', 403);
  const body = await readJson(request);
  if (!body || !timingSafeEq(String(body.token || ''), env.SEED_TOKEN)) return nope('no.', 403);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM forts').first();
  if (count && count.n > 0) return nope('the forts already exist. seeding is a one-time thing.', 409);
  const connor = cleanCode(body.connor_code);
  const lookoutKushman = cleanCode(body.kushman_code);
  const baseCampKushman = cleanCode(body.base_camp_code || body.kushman_code);
  if (connor.length < 4 || lookoutKushman.length < 4 || baseCampKushman.length < 4) {
    return nope('all starter codes need 4+ characters.');
  }
  if (connor.trim().toUpperCase() === lookoutKushman.trim().toUpperCase()) {
    return nope('connor and kushman need different codes inside the lookout.');
  }
  const t = now();
  const lookoutSalt = await randomSalt();
  const baseSalt = await randomSalt();
  await env.DB.prepare(
    'INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).bind('the_lookout', 'the_lookout', 'The Lookout', 'DALE', lookoutSalt, t).run();
  await env.DB.prepare(
    'INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
  ).bind('base_camp', 'base_camp', 'Base Camp', 'DALE', baseSalt, t).run();
  await env.DB.prepare(
    'INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at) VALUES (?, ?, ?, 1, ?)'
  ).bind('the_lookout', 'CONNOR', await hashCode(lookoutSalt, connor), t).run();
  await env.DB.prepare(
    'INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind('the_lookout', 'KUSHMAN', await hashCode(lookoutSalt, lookoutKushman), t).run();
  await env.DB.prepare(
    'INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at) VALUES (?, ?, ?, 1, ?)'
  ).bind('base_camp', 'KUSHMAN', await hashCode(baseSalt, baseCampKushman), t).run();
  return json({ ok: true, note: 'The Lookout and Base Camp are seeded. tell them their codes, then delete the SEED_TOKEN secret.' });
}

async function handleFortCreate(env, request) {
  if (!env.SEED_TOKEN) return nope('fort creation is not enabled.', 403);
  const body = await readJson(request);
  if (!body || !timingSafeEq(String(body.token || ''), env.SEED_TOKEN)) return nope('no.', 403);
  const r = await createFort(env, {
    displayName: body.display_name,
    slug: body.slug || body.display_name,
    founderHandle: body.founder_handle,
    founderCode: body.founder_code
  });
  if (!r.ok) return nope(r.error, r.status || 400);
  return json({ ok: true, fort: { id: r.fort.id, slug: r.fort.slug, display_name: r.fort.display_name } });
}

/* the whole config endpoint is gone: a fort's identity — name, slug, AND staff —
   is carved at the founding. nothing about a fort is penciled anymore. any POST
   to the old /api/config path gets one sentence (see the router). */

async function handleRoster(env, fort, session) {
  if (session.role !== 'founder') return nope('the roster is founder business.', 403);
  const rows = (await env.DB.prepare('SELECT * FROM visits WHERE fort_id=? ORDER BY last_seen DESC').bind(fort.id).all()).results || [];
  return json({ ok: true, roster: rows });
}

/* a 404 a kid can read. JSON for machines, a sign on the tree for browsers. */
function wantsHtml(request) {
  return (request.headers.get('Accept') || '').includes('text/html');
}
function fortNotFound(request) {
  if (!wantsHtml(request)) return nope('that fort does not exist. check the ladder label.', 404);
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>no fort here</title>
<style>body{background:#141009;color:#c9bda3;font:16px/1.8 ui-monospace,Menlo,monospace;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}a{color:#9ee493}p{margin:6px 0}</style></head>
<body><div><p>you climbed the wrong branch.</p><p>there is no fort at this address. there may never have been.<br>the squirrels are not talking.</p><p><a href="/">back down the tree</a></p></div></body></html>`,
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function handleAsset(env, request, fort, path) {
  const assetPath = ROOM_ASSETS.get(path);
  if (assetPath === '/handbook.html') {
    // the founder's field manual: any founder of THIS fort may read it.
    const session = await readSession(env, request, fort);
    if (!session || session.role !== 'founder') {
      return new Response('not found. some boards are not on your map.', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    }
  }
  const res = await env.ASSETS.fetch(assetRequest(request, assetPath || path));
  if (res.status === 404) return fortNotFound(request);
  return withHtmlHeaders(res);
}

/* ---------------- saplings (founder powers) ---------------- */

async function handleGrantMint(env, request, fort, session) {
  if (session.role !== 'founder') return nope('saplings grow for founders only.', 403);
  // a newborn fort can't grow saplings for its first day — otherwise one kid
  // daisy-chains fort -> sapling -> fort -> sapling all afternoon. the roots
  // (parent_fort IS NULL) were here before saplings existed and don't wait.
  if (fort.parent_fort && now() - fort.created_at < DAY) {
    const hours = Math.ceil((DAY - (now() - fort.created_at)) / 3600);
    return nope('this fort is still a sapling itself. the nursery opens when the fort is a day old — about '
      + hours + ' more hour' + (hours === 1 ? '' : 's') + '. decorate.', 429);
  }
  const unused = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM grants WHERE granted_by_fort=? AND used_at IS NULL AND composted_at IS NULL'
  ).bind(fort.id).first();
  if (unused && unused.n >= GRANTS_UNUSED_MAX) {
    return nope('the nursery is full. plant one first, or compost one.', 429);
  }
  // saplings grow at sapling speed: one per fort per day, counted from the last
  // one grown — planted, composted, or still waiting. the soil keeps every
  // receipt, so no amount of mint-compost churn hurries it.
  const last = await env.DB.prepare(
    'SELECT MAX(created_at) AS t FROM grants WHERE granted_by_fort=?'
  ).bind(fort.id).first();
  if (last && last.t && now() - last.t < DAY) {
    const hours = Math.ceil((DAY - (now() - last.t)) / 3600);
    return nope('the nursery grows one sapling a day. the soil needs about ' + hours + ' more hour' + (hours === 1 ? '' : 's') + '.', 429);
  }
  const body = await readJson(request);
  const note = cleanText(body && body.note, 60);
  const token = makeSaplingToken();
  const h = await saplingHash(env, token);
  await env.DB.prepare(
    'INSERT INTO grants (token_hash, granted_by_fort, granted_by_handle, note, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(h, fort.id, session.name, note || null, now()).run();
  // the token appears exactly once, right here. it is stored nowhere in this form.
  return json({ ok: true, token, note: 'one sapling. say it to exactly one person. lost saplings can\'t be found — compost and grow another.' });
}

async function handleGrantList(env, fort, session) {
  if (session.role !== 'founder') return nope('the nursery ledger is founder business.', 403);
  const rows = (await env.DB.prepare(
    'SELECT id, note, created_at, used_at, used_by_fort, composted_at FROM grants WHERE granted_by_fort=? ORDER BY id DESC'
  ).bind(fort.id).all()).results || [];
  return json({ ok: true, grants: rows });
}

async function handleGrantRevoke(env, request, fort, session) {
  if (session.role !== 'founder') return nope('composting is founder business.', 403);
  const body = await readJson(request);
  const id = parseInt(body && body.id, 10);
  if (!id) return nope('which sapling?');
  // composting kills the sapling but keeps its date in the ledger — nursery
  // SPACE frees up, the one-a-day clock does not. no mint-compost-mint games.
  const r = await env.DB.prepare(
    'UPDATE grants SET composted_at=? WHERE id=? AND granted_by_fort=? AND used_at IS NULL AND composted_at IS NULL'
  ).bind(now(), id, fort.id).run();
  if (!r.meta || !r.meta.changes) return nope('that sapling is already a fort, already compost, or never was yours.', 409);
  return json({ ok: true, note: 'composted. the nursery has room again. the soil keeps the receipt.' });
}

/* ---------------- the department of new forts ---------------- */

async function handleFound(env, request, ip) {
  if (rateLimited('found:' + ip, 10, 600)) return nope('the department is at lunch. ten minutes.', 429);
  const body = await readJson(request);
  if (!body) return nope('json required');

  // the sapling first — nothing else is discussable without one
  const h = await saplingHash(env, body.token);
  if (!h) return nope('that is not a sapling. that is a stick. try again.', 403);
  const grant = await env.DB.prepare('SELECT * FROM grants WHERE token_hash=?').bind(h).first();
  if (!grant) return nope('that is not a sapling. that is a stick. try again.', 403);
  if (grant.used_at) return nope('that sapling already grew a fort. saplings only do it once.', 403);
  if (grant.composted_at) return nope('that sapling went to compost. ask for a fresh one.', 403);

  // the registry
  const reg = await registryCheck(env, body.fort_name);
  if (reg.bad) return nope(reg.bad);
  if (reg.reserved) return json({ ok: false, reserved: true, error: 'that name belongs to the tree. pick another.' }, 400);
  if (reg.taken && body.check) {
    const existing = await getFortBySlug(env, normalizeFortSlug(cleanFortName(body.fort_name)));
    const when = existing ? new Date(existing.created_at * 1000).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toLowerCase() : 'a while ago';
    return json({ ok: false, taken: true, issued: reg.issued,
      error: `${cleanFortName(body.fort_name).toUpperCase()} already exists. founded ${when} by someone faster.` }, 409);
  }
  if (body.check) return json({ ok: true, free: true, name: reg.name, slug: reg.slug });
  if (reg.taken) {
    // full submit raced into a collision — hand back the offer instead of failing
    return json({ ok: false, taken: true, issued: reg.issued, error: 'somebody just took that name. the registry offers you a number.' }, 409);
  }

  // the rest of FORM 1
  const kind = COMPANION_KINDS.includes(body.companion_kind) ? body.companion_kind : null;
  if (!kind) return nope('the fort requires staff. one of the five applicants. no write-ins.');
  const companionName = cleanName(String(body.companion_name || '').slice(0, 10));
  if (!companionName) return nope('the staff needs a name. it goes on the paperwork.');
  const handle = cleanName(body.handle);
  const code = cleanCode(body.code);
  if (!handle) return nope('the founder needs a handle. letters and numbers.');
  if (code.length < 4) return nope('your knock needs 4+ characters. the raccoons insist.');
  if (body.agree !== true) return nope('the rules are the door. knock the sign.');

  // consume the sapling FIRST, conditionally — one sapling can never grow two forts
  const consumed = await env.DB.prepare(
    'UPDATE grants SET used_at=?, used_by_fort=? WHERE id=? AND used_at IS NULL AND composted_at IS NULL'
  ).bind(now(), reg.slug, grant.id).run();
  if (!consumed.meta || !consumed.meta.changes) {
    return nope('that sapling already grew a fort. saplings only do it once.', 403);
  }

  const salt = await randomSalt();
  const t = now();
  try {
    await env.DB.prepare(
      'INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at, parent_fort, founded_by_grant, companion_kind) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)'
    ).bind(reg.slug, reg.slug, reg.name, companionName, salt, t, grant.granted_by_fort, grant.id, kind).run();
  } catch (e) {
    // lost a naming race at the last instant — give the sapling back and re-offer
    await env.DB.prepare('UPDATE grants SET used_at=NULL, used_by_fort=NULL WHERE id=?').bind(grant.id).run();
    const reg2 = await registryCheck(env, body.fort_name);
    return json({ ok: false, taken: true, issued: reg2.issued || null,
      error: 'somebody just took that name. the registry offers you a number.' }, 409);
  }
  await env.DB.prepare(
    'INSERT INTO members (fort_id, handle, code_hash, is_founder, created_at) VALUES (?, ?, ?, 1, ?)'
  ).bind(reg.slug, handle, await hashCode(salt, code), t).run();
  await env.DB.prepare(
    'INSERT INTO agreements (fort_id, handle, rules_version, agreed_at) VALUES (?, ?, ?, ?)'
  ).bind(reg.slug, handle, RULES_VERSION, t).run();

  await tellTheManagement(env, `new fort: ${reg.name}`,
    `fort: ${reg.name} (/${reg.slug}/)\nfounder handle: ${handle}\nvouched by: ${grant.granted_by_handle} of ${grant.granted_by_fort}\nsapling note: ${grant.note || '(none)'}`);

  const fort = await getFortBySlug(env, reg.slug);
  const token = await makeSession(env, fort, 'founder', handle);
  return withLegacyCookieClear(json(
    { ok: true, slug: reg.slug, fort_name: reg.name, note: 'FOUNDED. the paperwork is framed. the fort is yours.' },
    200, { 'Set-Cookie': sessionCookie(token, fort) }
  ));
}

/* ---------------- speak to the management ---------------- */

async function handleReport(env, request, ip) {
  if (rateLimited('report:' + ip, 3, 3600)) {
    return nope('the management has your earlier notes. it reads at dog speed. try again in an hour.', 429);
  }
  const body = await readJson(request);
  if (!body) return nope('json required');
  const reason = cleanText(body.reason, 1000);
  if (!reason) return nope('the management needs to know what is wrong. one sentence will do.');
  const fortSlug = normalizeFortSlug(String(body.fort || '')) || null;
  const page = cleanText(body.page, 120) || null;
  const contact = cleanText(body.contact, 120) || null;
  await env.DB.prepare(
    'INSERT INTO reports (fort_id, page, reason, contact, created_at, ip) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(fortSlug, page, reason, contact, now(), ip).run();
  await tellTheManagement(env, 'someone spoke to the management',
    `fort: ${fortSlug || '(not named)'}\npage: ${page || '(not named)'}\nsays: ${reason}\nreach them: ${contact || '(no contact left)'}`);
  return json({ ok: true, note: 'the management has been notified. the management is, in this case, not the dog.' });
}

/* the rules knock, for members who joined before the sign went up (or after it changed) */
async function handleAgree(env, request, fort, session) {
  const existing = await env.DB.prepare(
    'SELECT id FROM agreements WHERE fort_id=? AND handle=? AND rules_version=?'
  ).bind(fort.id, session.name, RULES_VERSION).first();
  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO agreements (fort_id, handle, rules_version, agreed_at) VALUES (?, ?, ?, ?)'
    ).bind(fort.id, session.name, RULES_VERSION, now()).run();
  }
  return json({ ok: true, note: 'heard you. door\'s open.' });
}

/* every URL in a sealed fort gets one sentence. firm, not scary, nothing deleted. */
function sealedResponse(request) {
  const msg = 'this fort is sealed pending a raccoon council review. nothing is lost. the management will speak when it speaks.';
  if (!wantsHtml(request)) return json({ ok: false, sealed: true, error: msg }, 403);
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>sealed</title>
<style>body{background:#141009;color:#c9bda3;font:16px/1.9 ui-monospace,Menlo,monospace;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:20px}a{color:#9ee493}</style></head>
<body><div><p>${msg}</p><p><a href="/">back down the tree</a></p></div></body></html>`,
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...HTML_SECURITY_HEADERS } });
}

/* ---------------- router ---------------- */

/* legacy root URLs from the single-fort era. bookmarks and muscle memory
   keep working: they walk to Connor's fort, where they always led. */
const LEGACY_ROOT_REDIRECTS = new Set([
  '/index.html', '/index',
  '/paint', '/paint.html', '/kitchen', '/kitchen.html',
  '/gifmachine', '/gifmachine.html', '/handbook', '/handbook.html'
]);

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const method = request.method;

  // the grove: the front of the tree. denies everything, remembers your ladders.
  if (path === '/') {
    return withHtmlHeaders(await env.ASSETS.fetch(assetRequest(request, '/grove.html')));
  }
  // the department of new forts, and the sign anyone may read
  if (path === '/plant' || path === '/plant.html') {
    return withHtmlHeaders(await env.ASSETS.fetch(assetRequest(request, '/plant.html')));
  }
  if (path === '/rules' || path === '/rules.html') {
    return withHtmlHeaders(await env.ASSETS.fetch(assetRequest(request, '/rules.html')));
  }
  if (path === '/grove.html') {
    url.pathname = '/';
    return Response.redirect(url.toString(), 301);
  }
  if (path === '/robots.txt') {
    // the fort does not want visitors it didn't invite. this includes robots.
    return new Response('# the fort is not a website. it is a fort.\nUser-agent: *\nDisallow: /\n',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (path === '/favicon.ico') {
    const res = await env.ASSETS.fetch(assetRequest(request, '/favicon.ico'));
    return res.status === 404 ? new Response(null, { status: 404 }) : res;
  }
  if (LEGACY_ROOT_REDIRECTS.has(path)) {
    url.pathname = path.startsWith('/index') ? `/${DEFAULT_FORT_SLUG}/`
      : `/${DEFAULT_FORT_SLUG}${path.endsWith('.html') ? path : path + '.html'}`;
    return Response.redirect(url.toString(), 301);
  }

  // global seed/bootstrap routes, before a fort exists. token-gated AND
  // ip-throttled — nobody gets unlimited guesses at an operator secret.
  if ((path === '/api/setup' || path === '/api/seed' || path === '/api/forts/create') && method === 'POST') {
    if (rateLimited('bootstrap:' + ip, 5, 600)) return nope('the founding paperwork office is closed for ten minutes.', 429);
    if (path === '/api/setup') return handleSetup(env, request);
    if (path === '/api/seed') return handleSeed(env, request);
    return handleFortCreate(env, request);
  }
  // the two global doors: founding a fort (sapling required) and the management's mailbox
  if (path === '/api/found' && method === 'POST') return handleFound(env, request, ip);
  if (path === '/api/report' && method === 'POST') return handleReport(env, request, ip);

  const fortCtx = await requireFortFromRequest(env, request);
  if (!fortCtx) return fortNotFound(request);
  if (fortCtx.needsCanonical || (fortCtx.restPath === '/' && !path.endsWith('/'))) {
    return Response.redirect(canonicalFortUrl(request, fortCtx), 308);
  }
  const fort = fortCtx.fort;
  const route = fortCtx.restPath;

    // the seal comes before EVERYTHING — pages, api, media. no side doors.
    if (fort.frozen) return sealedResponse(request);

    if (!route.startsWith('/api/')) {
      return handleAsset(env, request, fort, route);
    }

    if (route === '/api/knock' && method === 'POST') return handleKnock(env, request, fort, ip);
    // logout just clears the cookie — no session required (a stale cookie can still leave)
    if (route === '/api/logout' && method === 'POST') return handleLogout(fort);
    // the spare key works from OUTSIDE the door — that is its entire job
    if (route === '/api/spare/use' && method === 'POST') return handleSpareUse(env, request, fort, ip);

    // everything below the door requires a living session
    const session = await readSession(env, request, fort);
    if (!session) return nope('no session. knock first. the door is not decorative.', 401);

    if (route === '/api/state' && method === 'GET') {
      const founder = await env.DB.prepare(
        'SELECT handle FROM members WHERE fort_id=? AND is_founder=1 ORDER BY created_at ASC LIMIT 1'
      ).bind(fort.id).first();
      const agreed = await env.DB.prepare(
        'SELECT id FROM agreements WHERE fort_id=? AND handle=? AND rules_version=?'
      ).bind(fort.id, session.name, RULES_VERSION).first();
      return json({ ok: true, name: session.name, role: session.role,
        fort_name: fort.display_name, fort_slug: fort.slug, dog_name: fort.dog_name,
        companion_kind: fort.companion_kind || 'dog',
        founder_name: founder ? founder.handle : null,
        rules_version: RULES_VERSION, agreed: !!agreed,
        spare_ready: session.spare_ready });
    }
    if (route === '/api/wall' && method === 'GET') return handleWall(env, request, fort, session);
    if (route === '/api/post' && method === 'POST') return handlePost(env, request, fort, session);
    if (route === '/api/reply' && method === 'POST') return handleReply(env, request, fort, session);
    if (route === '/api/delete' && method === 'POST') return handleDelete(env, request, fort, session);
    if (route === '/api/upload' && method === 'POST') return handleUpload(env, request, fort, session);
    if (route.startsWith('/api/media/') && method === 'GET') return handleMedia(env, fort, route.slice('/api/media/'.length));
    if (route === '/api/dict' && method === 'GET') return handleDictGet(env, fort);
    if (route === '/api/dict' && method === 'POST') return handleDictAdd(env, request, fort, session);
    if (route === '/api/dict/status' && method === 'POST') return handleDictStatus(env, request, fort, session);
    if (route === '/api/mycode' && method === 'POST') return handleMyCode(env, request, fort, session);
    if (route === '/api/spare/cut' && method === 'POST') return handleSpareCut(env, request, fort, session);
    if (route === '/api/agree' && method === 'POST') return handleAgree(env, request, fort, session);
    if (route === '/api/grants' && method === 'GET') return handleGrantList(env, fort, session);
    if (route === '/api/grants/mint' && method === 'POST') return handleGrantMint(env, request, fort, session);
    if (route === '/api/grants/revoke' && method === 'POST') return handleGrantRevoke(env, request, fort, session);
    if (route === '/api/members' && method === 'GET') return handleMembers(env, fort, session);
    if (route === '/api/members/add' && method === 'POST') return handleMemberAdd(env, request, fort, session);
    if (route === '/api/members/reset' && method === 'POST') {
      return nope('nobody re-keys another person\'s knock anymore. not even the founder. lost knocks use the spare key at the door.', 410);
    }
    if (route === '/api/config' && method === 'POST') {
      return nope('the fort was carved at the founding — name, slug, and staff. it stays.', 410);
    }
    if (route === '/api/roster' && method === 'GET') return handleRoster(env, fort, session);

    return nope('that room does not exist. yet?', 404);
}

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (e) {
      // D1 hiccup, R2 hiccup, cosmic ray. the kid gets a sentence, not a stack trace.
      console.error('fort internal error:', e.message);
      return json({ ok: false, error: 'something fell over inside the fort. the dog is looking into it. try again in a minute.' }, 500);
    }
  }
};
