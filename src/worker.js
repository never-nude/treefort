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
  const code = cleanText(body.code, 64).toUpperCase();
  const name = cleanName(body.name);
  if (!code || !name) return nope('a code and a name. that is the whole form.');

  const h = await sha256hex(cfg.salt + code);
  let role = null;
  if (timingSafeEq(h, cfg.founder_hash)) role = 'founder';
  else if (timingSafeEq(h, cfg.fort_hash)) role = 'member';

  if (!role) {
    if (!fail || t - fail.window_start >= KNOCK_WINDOW) {
      await env.DB.prepare(
        'INSERT INTO knock_fails (ip, fails, window_start) VALUES (?, 1, ?) ' +
        'ON CONFLICT(ip) DO UPDATE SET fails=1, window_start=?'
      ).bind(ip, t, t).run();
    } else {
      await env.DB.prepare('UPDATE knock_fails SET fails=fails+1 WHERE ip=?').bind(ip).run();
    }
    return json({ ok: false, error: 'that is not the code. the raccoon council has been notified.' }, 401);
  }

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

async function handleLock(env, request, session, cfg) {
  if (session.role !== 'founder') return nope('only the founder changes the locks.', 403);
  const body = await readJson(request);
  const newCode = cleanText(body && body.new_code, 64).toUpperCase();
  if (newCode.length < 4) return nope('4+ characters. the raccoons insist.');
  const h = await sha256hex(cfg.salt + newCode);
  if (timingSafeEq(h, cfg.founder_hash)) return nope('that is the founder code. pick literally anything else.');
  const newGen = cfg.gen + 1;
  await env.DB.prepare('UPDATE config SET gen=?, fort_hash=? WHERE id=1').bind(newGen, h).run();
  // re-key the founder so their own session survives the lock change
  const token = await makeSession(env, newGen, 'founder', session.name);
  return json({ ok: true, gen: newGen, note: 'the locks are changed. everyone knocks again. spread the new code however you like.' },
    200, { 'Set-Cookie': sessionCookie(token) });
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
    if (path === '/api/lock' && method === 'POST') return handleLock(env, request, session, cfg);
    if (path === '/api/config' && method === 'POST') return handleConfig(env, request, session);
    if (path === '/api/roster' && method === 'GET') return handleRoster(env, session);

    return nope('that room does not exist. yet?', 404);
  }
};
