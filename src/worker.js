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
async function makeSession(env, gen, role, name) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * DAY;
  const body = ['v1', gen, role, encodeURIComponent(name), exp].join('.');
  const sig = await hmacHex(env.SESSION_SECRET, body);
  return body + '.' + sig;
}
async function readSession(env, request, cfg) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)fort_session=([^;]+)/);
  if (!m) return null;
  const raw = m[1];
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const body = raw.slice(0, i), sig = raw.slice(i + 1);
  const expect = await hmacHex(env.SESSION_SECRET, body);
  if (!timingSafeEq(sig, expect)) return null;
  const [v, gen, role, nameEnc, exp] = body.split('.');
  if (v !== 'v1') return null;
  if (parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return null;
  if (parseInt(gen, 10) !== cfg.gen) return null;   // the locks changed
  return { role, name: decodeURIComponent(nameEnc), gen: parseInt(gen, 10) };
}
function sessionCookie(token) {
  return `fort_session=${token}; Max-Age=${SESSION_DAYS * DAY}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
// Max-Age=0 tells the browser to forget the cookie. that is the whole of logging out —
// no name is stored anywhere, so leaving is just the door forgetting your face on purpose.
function clearSessionCookie() {
  return `fort_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
function handleLogout() {
  return json({ ok: true, note: 'you climbed down. the ladder is still there.' },
    200, { 'Set-Cookie': clearSessionCookie() });
}

/* ---------------- small utils ---------------- */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
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

/* ---------------- members / knocks ----------------
   a knock is one personal code. it hashes to exactly one member, and that member's
   handle is what gets stamped on their posts. no name is ever typed at the door, so
   nobody can wear someone else's name. we store only the hash, never the code. */
function cleanCode(raw) { return (typeof raw === 'string' ? raw : '').trim(); }
async function hashCode(salt, code) { return sha256hex(salt + code.trim().toUpperCase()); }
async function memberByHash(env, h) {
  return await env.DB.prepare('SELECT * FROM members WHERE code_hash=?').bind(h).first();
}
async function memberByHandle(env, handle) {
  return await env.DB.prepare('SELECT * FROM members WHERE handle=?').bind(handle).first();
}
// codes must be unique (a code IS an identity). returns the other owner's handle, or null.
async function codeTakenByOther(env, h, handle) {
  const row = await env.DB.prepare('SELECT handle FROM members WHERE code_hash=?').bind(h).first();
  return row && row.handle !== handle ? row.handle : null;
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

async function handleKnock(env, request, cfg, ip) {
  // cooldown check
  const t = now();
  const fail = await env.DB.prepare('SELECT * FROM knock_fails WHERE ip=?').bind(ip).first();
  if (fail && t - fail.window_start < KNOCK_WINDOW && fail.fails >= KNOCK_LIMIT) {
    const wait = KNOCK_WINDOW - (t - fail.window_start);
    return json({ ok: false, cooldown: wait, error: 'too many wrong codes. the door needs ' + wait + ' seconds to forget your face.' }, 423);
  }
  const body = await readJson(request);
  if (!body) return nope('json required');
  const code = cleanCode(body.code);
  if (!code) return nope('a knock is one code. that is the whole form.');

  // the code alone decides who you are. no name is typed, so no name can be faked.
  const h = await hashCode(cfg.salt, code);
  const member = await memberByHash(env, h);

  if (!member) {
    // wrong knock: count the miss, and never reveal whether any handle exists.
    if (!fail || t - fail.window_start >= KNOCK_WINDOW) {
      await env.DB.prepare(
        'INSERT INTO knock_fails (ip, fails, window_start) VALUES (?, 1, ?) ' +
        'ON CONFLICT(ip) DO UPDATE SET fails=1, window_start=?'
      ).bind(ip, t, t).run();
    } else {
      await env.DB.prepare('UPDATE knock_fails SET fails=fails+1 WHERE ip=?').bind(ip).run();
    }
    return json({ ok: false, error: 'that knock means nothing to the door. the raccoon council has been notified.' }, 401);
  }

  const role = member.is_founder ? 'founder' : 'member';
  const name = member.handle;

  await env.DB.prepare('DELETE FROM knock_fails WHERE ip=?').bind(ip).run();
  await env.DB.prepare(
    'INSERT INTO visits (name, first_seen, last_seen, knocks) VALUES (?, ?, ?, 1) ' +
    'ON CONFLICT(name) DO UPDATE SET last_seen=?, knocks=knocks+1'
  ).bind(name, t, t, t).run();

  const token = await makeSession(env, cfg.gen, role, name);
  return json(
    { ok: true, role, name, fort_name: cfg.fort_name, dog_name: cfg.dog_name },
    200,
    { 'Set-Cookie': sessionCookie(token) }
  );
}

async function handleWall(env, request, session) {
  const url = new URL(request.url);
  const before = parseInt(url.searchParams.get('before') || '0', 10);
  let q, binds;
  if (before > 0) {
    q = 'SELECT * FROM posts WHERE id < ? ORDER BY id DESC LIMIT ?';
    binds = [before, PAGE_SIZE + 1];
  } else {
    q = 'SELECT * FROM posts ORDER BY id DESC LIMIT ?';
    binds = [PAGE_SIZE + 1];
  }
  const rows = (await env.DB.prepare(q).bind(...binds).all()).results || [];
  const more = rows.length > PAGE_SIZE;
  const posts = rows.slice(0, PAGE_SIZE);

  let repliesByPost = {};
  if (posts.length) {
    const ids = posts.map(p => p.id);
    const ph = ids.map(() => '?').join(',');
    const rr = (await env.DB.prepare(
      `SELECT * FROM replies WHERE post_id IN (${ph}) ORDER BY id ASC`
    ).bind(...ids).all()).results || [];
    for (const r of rr) (repliesByPost[r.post_id] = repliesByPost[r.post_id] || []).push(
      { id: r.id, author: r.author, text: r.text, created: r.created }
    );
  }
  return json({
    ok: true,
    more,
    posts: posts.map(p => p.deleted
      ? { id: p.id, deleted: true, created: p.created, replies: repliesByPost[p.id] || [] }
      : { id: p.id, author: p.author, type: p.type, text: p.text, media_key: p.media_key,
          created: p.created, deleted: false, replies: repliesByPost[p.id] || [] })
  });
}

async function handlePost(env, request, session) {
  if (rateLimited('post:' + session.name, 8, 60)) {
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
  }
  const r = await env.DB.prepare(
    'INSERT INTO posts (author, type, text, media_key, created) VALUES (?, ?, ?, ?, ?)'
  ).bind(session.name, type, text || null, mediaKey, now()).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function handleReply(env, request, session) {
  if (rateLimited('reply:' + session.name, 15, 60)) return nope('easy. the riff will keep.', 429);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const postId = parseInt(body.post_id, 10);
  const text = cleanText(body.text, REPLY_TEXT_MAX);
  if (!postId || !text) return nope('a reply needs a post and some words.');
  const post = await env.DB.prepare('SELECT id, deleted FROM posts WHERE id=?').bind(postId).first();
  if (!post) return nope('that post does not exist.', 404);
  const r = await env.DB.prepare(
    'INSERT INTO replies (post_id, author, text, created) VALUES (?, ?, ?, ?)'
  ).bind(postId, session.name, text, now()).run();
  return json({ ok: true, id: r.meta.last_row_id });
}

async function handleDelete(env, request, session) {
  if (session.role !== 'founder') return nope('only the management deletes. the management is a dog.', 403);
  const body = await readJson(request);
  const postId = parseInt(body && body.post_id, 10);
  if (!postId) return nope('which post?');
  await env.DB.prepare('UPDATE posts SET deleted=1, text=NULL, media_key=NULL WHERE id=?').bind(postId).run();
  return json({ ok: true });
}

async function handleUpload(env, request, session) {
  if (rateLimited('upload:' + session.name, 10, 60)) return nope('the darkroom is busy. one minute.', 429);
  const buf = await request.arrayBuffer();
  const type = sniffImage(buf);
  if (!type) return nope('that is not an image the fort recognizes. png, jpeg, gif, webp.', 415);
  const cap = type === 'image/gif' ? GIF_MAX : IMG_MAX;
  if (buf.byteLength > cap) return nope('too big. the fort has one shelf.', 413);
  if (buf.byteLength < 24) return nope('too small to be real.', 400);
  const key = randKey('m/');
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: type } });
  return json({ ok: true, media_key: key });
}

async function handleMedia(env, key) {
  if (!/^m\/[a-z0-9]+$/.test(key)) return nope('no.', 400);
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

async function handleDictGet(env) {
  const rows = (await env.DB.prepare('SELECT * FROM terms ORDER BY id DESC').all()).results || [];
  return json({ ok: true, terms: rows });
}
async function handleDictAdd(env, request, session) {
  if (rateLimited('dict:' + session.name, 6, 60)) return nope('the lexicographers need a break.', 429);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const term = cleanText(body.term, 40);
  const def = cleanText(body.def, 500);
  const example = cleanText(body.example, 300);
  if (!term || !def) return nope('a term and a definition. usage example optional but respected.');
  const r = await env.DB.prepare(
    'INSERT INTO terms (term, def, example, author, created) VALUES (?, ?, ?, ?, ?)'
  ).bind(term, def, example || null, session.name, now()).run();
  return json({ ok: true, id: r.meta.last_row_id });
}
async function handleDictStatus(env, request, session) {
  if (session.role !== 'founder') return nope('status chips are a founder power. them\'s the rules.', 403);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const id = parseInt(body.id, 10);
  const status = ['', 'CERTIFIED', 'ON LIFE SUPPORT', 'DECEASED'].includes(body.status) ? body.status : null;
  if (!id || status === null) return nope('unknown status. the fort recognizes three conditions and silence.');
  const died = status === 'DECEASED' ? now() : null;
  await env.DB.prepare('UPDATE terms SET status=?, died=? WHERE id=?').bind(status, died, id).run();
  return json({ ok: true });
}

// change your OWN knock. prove you know your current code, then set a new one.
// no email, no recovery — if you forget it, a founder resets it for you (below).
async function handleMyCode(env, request, session, cfg) {
  const body = await readJson(request);
  if (!body) return nope('json required');
  const cur = cleanCode(body.current_code), next = cleanCode(body.new_code);
  if (next.length < 4) return nope('the new knock needs 4+ characters. the raccoons insist.');
  const me = await memberByHandle(env, session.name);
  if (!me) return nope('you are not on the roster. this should be impossible. tell connor.', 409);
  const curH = await hashCode(cfg.salt, cur);
  if (!timingSafeEq(curH, me.code_hash)) return nope('that is not your current knock.');
  const nextH = await hashCode(cfg.salt, next);
  const clash = await codeTakenByOther(env, nextH, session.name);
  if (clash) return nope('someone already knocks like that. pick another.');
  await env.DB.prepare('UPDATE members SET code_hash=? WHERE handle=?').bind(nextH, session.name).run();
  return json({ ok: true, note: 'your knock is changed. the door will remember.' });
}

// founder: put a new person on the roster with a starter code (they change it later).
async function handleMemberAdd(env, request, session, cfg) {
  if (session.role !== 'founder') return nope('adding members is founder business.', 403);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const handle = cleanName(body.handle);
  const code = cleanCode(body.code);
  if (!handle) return nope('a member needs a handle. letters and numbers.');
  if (code.length < 4) return nope('their starter code needs 4+ characters.');
  if (await memberByHandle(env, handle)) return nope('someone already goes by ' + handle + '. handles are one to a customer.');
  const h = await hashCode(cfg.salt, code);
  if (await codeTakenByOther(env, h, handle)) return nope('that code already belongs to someone. pick another.');
  await env.DB.prepare('INSERT INTO members (handle, code_hash, is_founder, created_at) VALUES (?, ?, 0, ?)').bind(handle, h, now()).run();
  return json({ ok: true, note: handle + ' is on the roster. tell them their code in person.' });
}

// founder: reset a member's knock. THIS is the recovery flow — a kid forgot their code.
async function handleMemberReset(env, request, session, cfg) {
  if (session.role !== 'founder') return nope('resetting knocks is founder business.', 403);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const handle = cleanName(body.handle);
  const code = cleanCode(body.code);
  if (!handle || code.length < 4) return nope('a handle and a new 4+ character code.');
  if (!(await memberByHandle(env, handle))) return nope('nobody on the roster goes by ' + handle + '.', 404);
  const h = await hashCode(cfg.salt, code);
  if (await codeTakenByOther(env, h, handle)) return nope('that code already belongs to someone else. pick another.');
  await env.DB.prepare('UPDATE members SET code_hash=? WHERE handle=?').bind(h, handle).run();
  return json({ ok: true, note: handle + '\'s knock has been reset. tell them the new one.' });
}

// founder: who is on the roster (handles only — the door never coughs up a code).
async function handleMembers(env, session) {
  if (session.role !== 'founder') return nope('the roster is founder business.', 403);
  const rows = (await env.DB.prepare(
    'SELECT handle, is_founder, created_at FROM members ORDER BY is_founder DESC, handle ASC'
  ).all()).results || [];
  return json({ ok: true, members: rows });
}

// one-time grandfather seeding, guarded by a worker secret. refuses once anyone exists.
// this is how CONNOR (founder) and KUSHMAN get their first codes after deploy.
async function handleSeed(env, request, cfg) {
  if (!env.SEED_TOKEN) return nope('seeding is not enabled.', 403);
  const body = await readJson(request);
  if (!body || !timingSafeEq(String(body.token || ''), env.SEED_TOKEN)) return nope('no.', 403);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first();
  if (count && count.n > 0) return nope('the roster already exists. seeding is a one-time thing.', 409);
  const connor = cleanCode(body.connor_code), kushman = cleanCode(body.kushman_code);
  if (connor.length < 4 || kushman.length < 4) return nope('both starter codes need 4+ characters.');
  const ch = await hashCode(cfg.salt, connor), kh = await hashCode(cfg.salt, kushman);
  if (timingSafeEq(ch, kh)) return nope('give connor and kushman different codes.');
  const t = now();
  await env.DB.prepare('INSERT INTO members (handle, code_hash, is_founder, created_at) VALUES (?, ?, 1, ?)').bind('CONNOR', ch, t).run();
  await env.DB.prepare('INSERT INTO members (handle, code_hash, is_founder, created_at) VALUES (?, ?, 0, ?)').bind('KUSHMAN', kh, t).run();
  return json({ ok: true, note: 'CONNOR (founder) and KUSHMAN seeded. tell them their codes, then delete the SEED_TOKEN secret.' });
}

async function handleConfig(env, request, session) {
  if (session.role !== 'founder') return nope('renaming things is a founder power.', 403);
  const body = await readJson(request);
  if (!body) return nope('json required');
  const updates = [];
  const binds = [];
  if (typeof body.fort_name === 'string') {
    const v = cleanText(body.fort_name, 14).toUpperCase();
    if (v) { updates.push('fort_name=?'); binds.push(v); }
  }
  if (typeof body.dog_name === 'string') {
    const v = cleanText(body.dog_name, 10).toUpperCase();
    if (v) { updates.push('dog_name=?'); binds.push(v); }
  }
  if (!updates.length) return nope('nothing to rename.');
  await env.DB.prepare('UPDATE config SET ' + updates.join(', ') + ' WHERE id=1').bind(...binds).run();
  return json({ ok: true });
}

async function handleRoster(env, session) {
  if (session.role !== 'founder') return nope('the roster is founder business.', 403);
  const rows = (await env.DB.prepare('SELECT * FROM visits ORDER BY last_seen DESC').all()).results || [];
  return json({ ok: true, roster: rows });
}

/* ---------------- router ---------------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const method = request.method;

    // pre-config routes
    if (path === '/api/setup' && method === 'POST') return handleSetup(env, request);

    const cfg = await getConfig(env);
    if (!cfg) return nope('the fort is not founded yet. (run the setup step in DEPLOY.md.)', 503);

    if (path === '/api/knock' && method === 'POST') return handleKnock(env, request, cfg, ip);
    // one-time grandfather seeding (needs the secret, not a session — there are no members yet)
    if (path === '/api/seed' && method === 'POST') return handleSeed(env, request, cfg);
    // logout just clears the cookie — no session required (a stale cookie can still leave)
    if (path === '/api/logout' && method === 'POST') return handleLogout();

    // everything below the door requires a living session
    const session = await readSession(env, request, cfg);
    if (!session) return nope('no session. knock first. the door is not decorative.', 401);

    if (path === '/api/state' && method === 'GET') {
      return json({ ok: true, name: session.name, role: session.role,
        fort_name: cfg.fort_name, dog_name: cfg.dog_name });
    }
    if (path === '/api/wall' && method === 'GET') return handleWall(env, request, session);
    if (path === '/api/post' && method === 'POST') return handlePost(env, request, session);
    if (path === '/api/reply' && method === 'POST') return handleReply(env, request, session);
    if (path === '/api/delete' && method === 'POST') return handleDelete(env, request, session);
    if (path === '/api/upload' && method === 'POST') return handleUpload(env, request, session);
    if (path.startsWith('/api/media/') && method === 'GET') return handleMedia(env, path.slice('/api/media/'.length));
    if (path === '/api/dict' && method === 'GET') return handleDictGet(env);
    if (path === '/api/dict' && method === 'POST') return handleDictAdd(env, request, session);
    if (path === '/api/dict/status' && method === 'POST') return handleDictStatus(env, request, session);
    if (path === '/api/mycode' && method === 'POST') return handleMyCode(env, request, session, cfg);
    if (path === '/api/members' && method === 'GET') return handleMembers(env, session);
    if (path === '/api/members/add' && method === 'POST') return handleMemberAdd(env, request, session, cfg);
    if (path === '/api/members/reset' && method === 'POST') return handleMemberReset(env, request, session, cfg);
    if (path === '/api/config' && method === 'POST') return handleConfig(env, request, session);
    if (path === '/api/roster' && method === 'GET') return handleRoster(env, session);

    return nope('that room does not exist. yet?', 404);
  }
};
