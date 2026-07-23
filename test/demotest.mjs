/* demotest.mjs — proves the model home is a terrarium, not a door.
   runs the worker in-process (same stub pattern as doortest.mjs) and attacks
   the demo session from every angle we could think of:
     - demo cookie presented to a REAL fort's api  -> 401, every route
     - demo token with the fort id swapped         -> 401 (HMAC says no)
     - demo token re-signed with a guessed secret  -> 401
     - guest asking a real fort's media through the demo fort -> 404
     - guest touching keys/rosters/locks in the demo fort     -> 403
     - curator minting a sapling FROM the demo fort           -> 403
     - the 3 AM broom: guest things die, curator things survive
   node test/demotest.mjs */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHmac } from 'crypto';
const worker = (await import(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worker.js'))).default;

/* ---- tiny in-memory D1 (pattern-matched to the worker's queries) ---- */
const db = { forts: new Map(), members: [], posts: [], replies: [], terms: [], visits: new Map(), fails: new Map(), agreements: [] };
let postId = 0, replyId = 0;

function exec(sql, args) {
  const S = sql.replace(/\s+/g, ' ').trim();
  return {
    bind(...a) { return exec(sql, a); },
    async first() {
      if (S.startsWith('SELECT * FROM forts WHERE slug=?')) return db.forts.get(args[0]) || null;
      if (S.startsWith('SELECT * FROM members WHERE fort_id=? AND handle=?'))
        return db.members.find(m => m.fort_id === args[0] && m.handle === args[1]) || null;
      if (S.startsWith('SELECT * FROM members WHERE fort_id=? AND code_hash=?'))
        return db.members.find(m => m.fort_id === args[0] && m.code_hash === args[1]) || null;
      if (S.startsWith('SELECT handle FROM members WHERE fort_id=? AND code_hash=?'))
        return db.members.find(m => m.fort_id === args[0] && m.code_hash === args[1]) || null;
      if (S.startsWith('SELECT handle FROM members WHERE fort_id=? AND is_founder=1'))
        return db.members.find(m => m.fort_id === args[0] && m.is_founder) || null;
      if (S.startsWith('SELECT * FROM knock_fails')) return db.fails.get(args[0] + '|' + args[1]) || null;
      if (S.startsWith('SELECT id FROM agreements'))
        return db.agreements.find(a => a.fort_id === args[0] && a.handle === args[1] && a.rules_version === args[2]) || null;
      if (S.startsWith('SELECT author, deleted FROM posts WHERE fort_id=? AND id=?'))
        return db.posts.find(p => p.fort_id === args[0] && p.id === args[1]) || null;
      if (S.startsWith('SELECT id FROM posts WHERE fort_id=? AND media_key=?'))
        return db.posts.find(p => p.fort_id === args[0] && p.media_key === args[1] && !p.deleted) || null;
      if (S.startsWith('SELECT id, deleted FROM posts WHERE fort_id=? AND id=?'))
        return db.posts.find(p => p.fort_id === args[0] && p.id === args[1]) || null;
      throw new Error('unstubbed first(): ' + S);
    },
    async all() {
      if (S.startsWith('SELECT * FROM posts WHERE fort_id=? ORDER BY'))
        return { results: db.posts.filter(p => p.fort_id === args[0]).sort((a, b) => b.id - a.id).slice(0, args[1]) };
      if (S.startsWith('SELECT * FROM replies WHERE fort_id=? AND post_id IN'))
        return { results: db.replies.filter(r => r.fort_id === args[0] && args.slice(1).includes(r.post_id)) };
      if (S.startsWith('SELECT * FROM terms WHERE fort_id=?'))
        return { results: db.terms.filter(t => t.fort_id === args[0]) };
      throw new Error('unstubbed all(): ' + S);
    },
    async run() {
      if (S.startsWith('INSERT INTO visits')) { db.visits.set(args[0] + '|' + args[1], true); return ok(1); }
      if (S.startsWith('DELETE FROM knock_fails')) { db.fails.delete(args[0] + '|' + args[1]); return ok(1); }
      if (S.startsWith('INSERT INTO knock_fails')) { db.fails.set(args[0] + '|' + args[1], { fails: 1, window_start: args[2] }); return ok(1); }
      if (S.startsWith('UPDATE knock_fails')) { const f = db.fails.get(args[0] + '|' + args[1]); if (f) f.fails++; return ok(1); }
      if (S.startsWith('INSERT INTO posts')) { db.posts.push({ id: ++postId, fort_id: args[0], author: args[1], type: args[2], text: args[3], media_key: args[4], created: args[5], deleted: 0 }); return ok(1, postId); }
      if (S.startsWith('INSERT INTO replies')) { db.replies.push({ id: ++replyId, fort_id: args[0], post_id: args[1], author: args[2], text: args[3], created: args[4] }); return ok(1, replyId); }
      if (S.startsWith('DELETE FROM posts WHERE fort_id=? AND author=?')) { const n = db.posts.length; db.posts = db.posts.filter(p => !(p.fort_id === args[0] && p.author === args[1])); return ok(n - db.posts.length); }
      if (S.startsWith('DELETE FROM replies WHERE fort_id=? AND author=?')) { const n = db.replies.length; db.replies = db.replies.filter(r => !(r.fort_id === args[0] && r.author === args[1])); return ok(n - db.replies.length); }
      if (S.startsWith('DELETE FROM terms WHERE fort_id=? AND author=?')) { const n = db.terms.length; db.terms = db.terms.filter(t => !(t.fort_id === args[0] && t.author === args[1])); return ok(n - db.terms.length); }
      if (S.startsWith('INSERT INTO agreements')) { db.agreements.push({ fort_id: args[0], handle: args[1], rules_version: args[2] }); return ok(1); }
      throw new Error('unstubbed run(): ' + S);
    }
  };
  function ok(changes, last_row_id) { return { meta: { changes, last_row_id } }; }
}

const r2 = new Map();
const env = {
  SESSION_SECRET: 'test-secret-do-not-share',
  DB: { prepare: sql => exec(sql, []) },
  MEDIA: {
    async put(k, buf, opts) { r2.set(k, { buf, ct: opts.httpMetadata.contentType, customMetadata: opts.customMetadata || {} }); },
    async head(k) { const o = r2.get(k); return o ? { key: k, customMetadata: o.customMetadata } : null; },
    async get(k) { const o = r2.get(k); return o ? { body: o.buf, httpMetadata: { contentType: o.ct } } : null; },
    async list({ prefix, limit }) {
      const objects = [...r2.keys()].filter(k => k.startsWith(prefix)).slice(0, limit || 1000).map(key => ({ key }));
      return { objects, truncated: false };
    },
    async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) r2.delete(k); }
  },
  ASSETS: { fetch: async () => new Response('static', { headers: { 'Content-Type': 'text/html' } }) }
};

/* ---- the world: one REAL fort with a member, one model home ---- */
const sha = async s => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};
db.forts.set('the_lookout', { id: 'the_lookout', slug: 'the_lookout', display_name: 'The Lookout', dog_name: 'DALE', gen: 1, salt: 'realsalt', frozen: 0 });
db.forts.set('the_model_home', { id: 'the_model_home', slug: 'the_model_home', display_name: 'The Model Home', dog_name: 'BRENDA', gen: 1, salt: 'demosalt', frozen: 0, companion_kind: 'pigeon' });
db.members.push(
  { fort_id: 'the_lookout', handle: 'CONNOR', code_hash: await sha('realsalt' + 'REALKNOCK'), is_founder: 1, revoked: 0 },
  { fort_id: 'the_model_home', handle: 'CURATOR', code_hash: await sha('demosalt' + 'HOME-CURATORKNOCK'), is_founder: 1, revoked: 0 },
  { fort_id: 'the_model_home', handle: 'GUEST', code_hash: await sha('demosalt' + 'UNKNOWABLE'), is_founder: 0, revoked: 0 }
);
db.agreements.push({ fort_id: 'the_model_home', handle: 'GUEST', rules_version: 1 });
// a real fort's secret: one post with media, in the lookout only
r2.set('m/realpic1', { buf: 'REAL SECRET PIXELS', ct: 'image/png', customMetadata: { fort_id: 'the_lookout' } });
db.posts.push({ id: ++postId, fort_id: 'the_lookout', author: 'CONNOR', type: 'image', text: 'private', media_key: 'm/realpic1', created: 1, deleted: 0 });
// curator furniture that must survive the wipe
r2.set('m/homepaint1', { buf: 'CURATOR ART', ct: 'image/gif', customMetadata: {} });
db.posts.push({ id: ++postId, fort_id: 'the_model_home', author: 'CURATOR', type: 'painting', text: 'the sunset', media_key: 'm/homepaint1', created: 2, deleted: 0 });

/* ---- harness ---- */
const BASE = 'https://treefort.lol';
let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log('  ok — ' + name); }
  else { failed++; console.log('  FAIL — ' + name + (detail ? ' :: ' + detail : '')); }
}
const req = (path, { method = 'GET', cookie, body } = {}) =>
  worker.fetch(new Request(BASE + path, {
    method,
    headers: { ...(cookie ? { 'Cookie': 'fort_session=' + cookie } : {}), 'CF-Connecting-IP': '9.9.9.9', 'Accept': 'application/json', 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  }), env);

console.log('\n1. the open house door (/demo)');
const door = await req('/demo');
check('GET /demo redirects into the model home', door.status === 302 && door.headers.get('Location').endsWith('/the_model_home/'));
const setCookie = door.headers.get('Set-Cookie') || '';
check('cookie is scoped Path=/the_model_home', setCookie.includes('Path=/the_model_home'));
const demoToken = (setCookie.match(/fort_session=([^;]+)/) || [])[1];
check('a session token was minted', !!demoToken);
check('token embeds the demo fort id, no other', demoToken.split('.')[1] === 'the_model_home');

console.log('\n2. the demo session works — but only at home');
const state = await (await req('/the_model_home/api/state', { cookie: demoToken })).json();
check('guest state in the model home: ok', state.ok === true && state.name === 'GUEST' && state.role === 'member');
const guestPost = await (await req('/the_model_home/api/post', { method: 'POST', cookie: demoToken, body: { type: 'text', text: 'a guest was here' } })).json();
check('guest can post in the model home', guestPost.ok === true);

console.log('\n3. the same cookie, forced at a REAL fort (hostile client ignores cookie Path)');
for (const attempt of [
  ['GET', '/the_lookout/api/state'], ['GET', '/the_lookout/api/wall'],
  ['GET', '/the_lookout/api/dict'], ['GET', '/the_lookout/api/media/m/realpic1'],
  ['POST', '/the_lookout/api/post'], ['POST', '/the_lookout/api/reply'],
  ['POST', '/the_lookout/api/upload'], ['POST', '/the_lookout/api/delete'],
  ['GET', '/the_lookout/api/members'], ['GET', '/the_lookout/api/roster'],
  ['POST', '/the_lookout/api/grants/mint']
]) {
  const [method, path] = attempt;
  const r = await req(path, { method, cookie: demoToken, body: method === 'POST' ? {} : undefined });
  check(`${method} ${path} -> 401`, r.status === 401, 'got ' + r.status);
}

console.log('\n4. token surgery');
const parts = demoToken.split('.');
const swapped = ['v2', 'the_lookout', ...parts.slice(2)].join('.');
check('fort id swapped, signature kept -> 401', (await req('/the_lookout/api/state', { cookie: swapped })).status === 401);
const bodyOnly = swapped.split('.').slice(0, -1).join('.');
const resigned = bodyOnly + '.' + createHmac('sha256', 'guessed-secret').update(bodyOnly).digest('hex');
check('fort id swapped, re-signed with guessed secret -> 401', (await req('/the_lookout/api/state', { cookie: resigned })).status === 401);
const roleUp = [parts[0], parts[1], parts[2], 'founder', ...parts.slice(4)].join('.');
check('role escalated to founder, signature kept -> 401', (await req('/the_model_home/api/state', { cookie: roleUp })).status === 401);

console.log('\n5. cross-fort media through the demo fort');
const media = await req('/the_model_home/api/media/m/realpic1', { cookie: demoToken });
check("a real fort's media key via the model home -> 404", media.status === 404, 'got ' + media.status);

console.log('\n6. the narrower hallway (guest inside the model home)');
for (const [method, path] of [
  ['POST', '/the_model_home/api/mycode'], ['POST', '/the_model_home/api/spare/cut'],
  ['GET', '/the_model_home/api/grants'], ['POST', '/the_model_home/api/grants/mint'],
  ['POST', '/the_model_home/api/grants/revoke'], ['GET', '/the_model_home/api/members'],
  ['POST', '/the_model_home/api/members/add'], ['GET', '/the_model_home/api/roster'],
  ['POST', '/the_model_home/api/dict/status']
]) {
  const r = await req(path, { method, cookie: demoToken, body: method === 'POST' ? {} : undefined });
  check(`guest ${method} ${path} -> 403`, r.status === 403, 'got ' + r.status);
}

console.log('\n7. nothing grows from the model home (even for the curator)');
const knock = await req('/the_model_home/api/knock', { method: 'POST', body: { code: 'HOME-CURATORKNOCK' } });
const curatorToken = ((knock.headers.get('Set-Cookie') || '').match(/fort_session=([^;]+)/) || [])[1];
check('curator can knock (founder, real member)', (await knock.json()).ok === true);
const mint = await req('/the_model_home/api/grants/mint', { method: 'POST', cookie: curatorToken, body: {} });
check('curator sapling mint in the model home -> 403', mint.status === 403, 'got ' + mint.status);

console.log('\n8. a REAL session, forced at the model home (the boundary works both ways)');
const realKnock = await req('/the_lookout/api/knock', { method: 'POST', body: { code: 'REALKNOCK' } });
const realToken = ((realKnock.headers.get('Set-Cookie') || '').match(/fort_session=([^;]+)/) || [])[1];
check('real member can knock at the lookout', (await realKnock.json()).ok === true);
check('lookout session at the model home -> 401', (await req('/the_model_home/api/state', { cookie: realToken })).status === 401);

console.log('\n9. guest uploads live on the demo shelf');
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 7)]);
const upload = await (await worker.fetch(new Request(BASE + '/the_model_home/api/upload', {
  method: 'POST', headers: { 'Cookie': 'fort_session=' + demoToken, 'CF-Connecting-IP': '9.9.9.9' }, body: png
}), env)).json();
check('guest upload ok, key has the m/demo prefix', upload.ok === true && upload.media_key.startsWith('m/demo'), JSON.stringify(upload));

console.log('\n10. the 3 AM broom');
await req('/the_model_home/api/reply', { method: 'POST', cookie: demoToken, body: { post_id: 2, text: 'guest reply on curator post' } });
await worker.scheduled({}, env, { waitUntil: p => p });
await new Promise(r => setTimeout(r, 50));
check('guest posts are gone', !db.posts.some(p => p.fort_id === 'the_model_home' && p.author === 'GUEST'));
check('guest replies are gone', !db.replies.some(r => r.fort_id === 'the_model_home' && r.author === 'GUEST'));
check('guest media is gone', ![...r2.keys()].some(k => k.startsWith('m/demo')));
check('curator furniture survives', db.posts.some(p => p.fort_id === 'the_model_home' && p.author === 'CURATOR') && r2.has('m/homepaint1'));
check("the real fort's post and media are untouched", db.posts.some(p => p.fort_id === 'the_lookout') && r2.has('m/realpic1'));

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
