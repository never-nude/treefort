import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const worker = (await import(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worker.js'))).default;

/* ---- in-memory D1 stub (pattern-matched to the worker's queries) ---- */
const key2 = (a, b) => `${a}\u0000${b}`;
const db = {
  config: null,
  forts: new Map(),
  posts: [],
  replies: [],
  terms: [],
  visits: new Map(),
  fails: new Map(),
  members: new Map()
};
let postId = 0, replyId = 0, termId = 0;

function memberKey(fortId, handle) { return key2(fortId, handle); }
function failKey(fortId, ip) { return key2(fortId, ip); }
function visitKey(fortId, name) { return key2(fortId, name); }
function membersFor(fortId) { return [...db.members.values()].filter(m => m.fort_id === fortId); }

function prepare(sql) {
  return { bind(...args) { return exec(sql, args); }, ...exec(sql, []) };
}

function exec(sql, args) {
  const S = sql.replace(/\s+/g, ' ').trim();
  return {
    bind(...a) { return exec(sql, a); },
    async first() {
      if (S.startsWith('SELECT * FROM config')) return db.config;
      if (S.startsWith('SELECT * FROM forts WHERE slug=?')) return db.forts.get(args[0]) || null;
      if (S.startsWith('SELECT COUNT(*) AS n FROM forts')) return { n: db.forts.size };
      if (S.startsWith('SELECT * FROM knock_fails WHERE fort_id=? AND ip=?')) return db.fails.get(failKey(args[0], args[1])) || null;
      if (S.startsWith('SELECT id, deleted FROM posts WHERE fort_id=? AND id=?')) {
        const p = db.posts.find(p => p.fort_id === args[0] && p.id === args[1]);
        return p ? { id: p.id, deleted: p.deleted } : null;
      }
      if (S.startsWith('SELECT id FROM posts WHERE fort_id=? AND media_key=?')) {
        const p = db.posts.find(p => p.fort_id === args[0] && p.media_key === args[1] && p.deleted === 0);
        return p ? { id: p.id } : null;
      }
      if (S.startsWith('SELECT * FROM members WHERE fort_id=? AND code_hash=?')) {
        return membersFor(args[0]).find(m => m.code_hash === args[1]) || null;
      }
      if (S.startsWith('SELECT * FROM members WHERE fort_id=? AND handle=?')) {
        return db.members.get(memberKey(args[0], args[1])) || null;
      }
      if (S.startsWith('SELECT handle FROM members WHERE fort_id=? AND code_hash=?')) {
        const m = membersFor(args[0]).find(m => m.code_hash === args[1]);
        return m ? { handle: m.handle } : null;
      }
      if (S.startsWith('SELECT handle FROM members WHERE fort_id=? AND is_founder=1')) {
        const m = membersFor(args[0]).filter(m => m.is_founder === 1)
          .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))[0];
        return m ? { handle: m.handle } : null;
      }
      throw new Error('first? ' + S);
    },
    async all() {
      if (S.startsWith('SELECT * FROM posts WHERE fort_id=? AND id < ?')) {
        return { results: db.posts.filter(p => p.fort_id === args[0] && p.id < args[1]).sort((a, b) => b.id - a.id).slice(0, args[2]) };
      }
      if (S.startsWith('SELECT * FROM posts WHERE fort_id=? ORDER')) {
        return { results: db.posts.filter(p => p.fort_id === args[0]).sort((a, b) => b.id - a.id).slice(0, args[1]) };
      }
      if (S.startsWith('SELECT * FROM replies WHERE fort_id=? AND post_id IN')) {
        const ids = args.slice(1);
        return { results: db.replies.filter(r => r.fort_id === args[0] && ids.includes(r.post_id)).sort((a, b) => a.id - b.id) };
      }
      if (S.startsWith('SELECT * FROM terms WHERE fort_id=?')) {
        return { results: db.terms.filter(t => t.fort_id === args[0]).sort((a, b) => b.id - a.id) };
      }
      if (S.startsWith('SELECT * FROM visits WHERE fort_id=?')) {
        return { results: [...db.visits.values()].filter(v => v.fort_id === args[0]).sort((a, b) => b.last_seen - a.last_seen) };
      }
      if (S.startsWith('SELECT handle, is_founder, created_at FROM members WHERE fort_id=?')) {
        return {
          results: membersFor(args[0])
            .map(m => ({ handle: m.handle, is_founder: m.is_founder, created_at: m.created_at }))
            .sort((a, b) => (b.is_founder - a.is_founder) || a.handle.localeCompare(b.handle))
        };
      }
      throw new Error('all? ' + S);
    },
    async run() {
      if (S.startsWith('INSERT INTO config')) {
        db.config = { id: 1, gen: 1, salt: args[0], fort_hash: args[1], founder_hash: args[2], fort_name: 'TREEFORT', dog_name: 'DALE' };
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO forts')) {
        db.forts.set(args[0], {
          id: args[0],
          slug: args[1],
          display_name: args[2],
          dog_name: args[3],
          gen: 1,
          salt: args[4],
          created_at: args[5],
          renamed_at: null
        });
        return { meta: {} };
      }
      if (S.startsWith('UPDATE forts SET')) {
        const id = args[args.length - 1];
        const fort = db.forts.get(id);
        if (!fort) return { meta: {} };
        const cols = S.match(/SET (.*) WHERE/)[1].split(', ');
        cols.forEach((c, i) => {
          const name = c.split('=')[0];
          fort[name] = args[i];
        });
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO knock_fails')) {
        db.fails.set(failKey(args[0], args[1]), { fort_id: args[0], ip: args[1], fails: 1, window_start: args[2] });
        return { meta: {} };
      }
      if (S.startsWith('UPDATE knock_fails SET fails=fails+1')) {
        const f = db.fails.get(failKey(args[0], args[1]));
        if (f) f.fails++;
        return { meta: {} };
      }
      if (S.startsWith('DELETE FROM knock_fails')) {
        db.fails.delete(failKey(args[0], args[1]));
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO visits')) {
        const k = visitKey(args[0], args[1]);
        const v = db.visits.get(k);
        if (v) { v.last_seen = args[4]; v.knocks++; }
        else db.visits.set(k, { fort_id: args[0], name: args[1], first_seen: args[2], last_seen: args[3], knocks: 1 });
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO members')) {
        const isFounder = S.includes('VALUES (?, ?, ?, 1, ?)') ? 1 : 0;
        db.members.set(memberKey(args[0], args[1]), {
          fort_id: args[0],
          handle: args[1],
          code_hash: args[2],
          is_founder: isFounder,
          created_at: args[3]
        });
        return { meta: {} };
      }
      if (S.startsWith('UPDATE members SET code_hash=? WHERE fort_id=? AND handle=?')) {
        const m = db.members.get(memberKey(args[1], args[2]));
        if (m) m.code_hash = args[0];
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO posts')) {
        const p = { id: ++postId, fort_id: args[0], author: args[1], type: args[2], text: args[3], media_key: args[4], created: args[5], deleted: 0 };
        db.posts.push(p);
        return { meta: { last_row_id: p.id } };
      }
      if (S.startsWith('UPDATE posts SET deleted=1')) {
        const p = db.posts.find(p => p.fort_id === args[0] && p.id === args[1]);
        if (p) { p.deleted = 1; p.text = null; p.media_key = null; }
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO replies')) {
        const r = { id: ++replyId, fort_id: args[0], post_id: args[1], author: args[2], text: args[3], created: args[4] };
        db.replies.push(r);
        return { meta: { last_row_id: r.id } };
      }
      if (S.startsWith('INSERT INTO terms')) {
        const t = { id: ++termId, fort_id: args[0], term: args[1], def: args[2], example: args[3], author: args[4], status: '', created: args[5], died: null };
        db.terms.push(t);
        return { meta: { last_row_id: t.id } };
      }
      if (S.startsWith('UPDATE terms SET status=')) {
        const t = db.terms.find(t => t.fort_id === args[2] && t.id === args[3]);
        if (t) { t.status = args[0]; t.died = args[1]; }
        return { meta: {} };
      }
      throw new Error('run? ' + S);
    }
  };
}

const r2 = new Map();
const env = {
  SESSION_SECRET: 'test-secret-do-not-share',
  SEED_TOKEN: 'seed-me-once',
  DB: { prepare },
  MEDIA: {
    async put(k, buf, opts) { r2.set(k, { buf, ct: opts.httpMetadata.contentType, customMetadata: opts.customMetadata || {} }); },
    async head(k) {
      const o = r2.get(k);
      return o ? { key: k, customMetadata: o.customMetadata } : null;
    },
    async get(k) {
      const o = r2.get(k);
      return o ? { body: o.buf, httpMetadata: { contentType: o.ct } } : null;
    }
  },
  ASSETS: { fetch: async () => new Response('static') }
};

let cookies = {};
async function call(path, { method = 'GET', body, raw, ip = '1.1.1.1', who = 'anon', accept } = {}) {
  const headers = {};
  if (cookies[who]) headers.Cookie = cookies[who].value;
  headers['CF-Connecting-IP'] = ip;
  if (accept) headers.Accept = accept;
  let reqBody;
  if (raw) reqBody = raw;
  else if (body) { reqBody = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await worker.fetch(new Request('https://treefort.lol' + path, { method, headers, body: reqBody }), env);
  // responses may carry several Set-Cookie headers (session + legacy-cookie clear).
  // the jar is path-aware like a browser: a clear only deletes a cookie set at the
  // SAME path, so the legacy Path=/ clear cannot delete a Path=/the_lookout session.
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : (res.headers.get('Set-Cookie') ? [res.headers.get('Set-Cookie')] : []);
  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    if (!pair.startsWith('fort_session=')) continue;
    const cookiePath = (sc.match(/;\s*Path=([^;]+)/i) || [])[1] || '/';
    const isClear = pair === 'fort_session=' && /Max-Age=0/i.test(sc);
    if (isClear) {
      if (cookies[who] && cookies[who].path === cookiePath) delete cookies[who];
    } else {
      cookies[who] = { value: pair, path: cookiePath };
    }
  }
  let data = null;
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('json')) data = await res.json();
  return { status: res.status, data, res, location: res.headers.get('Location'), setCookies };
}

const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); };
const png = () => { const b = new Uint8Array(64); b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); return b.buffer; };

(async () => {
  let r = await call('/');
  assert(r.status === 302 && r.location === 'https://treefort.lol/the_lookout/', 'root redirects to The Lookout');

  r = await call('/paint.html');
  assert(r.status === 301 && r.location === 'https://treefort.lol/the_lookout/paint.html',
    'legacy root room URL walks to The Lookout (old bookmarks keep working)');
  r = await call('/kitchen');
  assert(r.status === 301 && r.location === 'https://treefort.lol/the_lookout/kitchen.html',
    'legacy extensionless room URL redirects too');
  r = await call('/index.html');
  assert(r.status === 301 && r.location === 'https://treefort.lol/the_lookout/', 'legacy /index.html goes home');
  r = await call('/robots.txt');
  assert(r.status === 200, 'robots.txt tells crawlers to leave the fort alone');

  r = await call('/the_lookout/api/state');
  assert(r.status === 404, 'pre-seed The Lookout is not present yet');

  r = await call('/api/seed', { method: 'POST', body: { token: 'wrong', connor_code: 'FOUNDER1', kushman_code: 'DADCODE1', base_camp_code: 'BASECAMP1' } });
  assert(r.status === 403, 'seed rejects wrong token');
  r = await call('/api/seed', { method: 'POST', body: { token: 'seed-me-once', connor_code: 'aaa', kushman_code: 'bbb' } });
  assert(r.status === 400, 'seed rejects short codes');
  r = await call('/api/seed', { method: 'POST', body: { token: 'seed-me-once', connor_code: 'SAMEONE', kushman_code: 'sameone' } });
  assert(r.status === 400, 'seed rejects identical Lookout codes');
  r = await call('/api/seed', { method: 'POST', body: { token: 'seed-me-once', connor_code: 'FOUNDER1', kushman_code: 'DADCODE1', base_camp_code: 'BASECAMP1' } });
  assert(r.data.ok, 'seed creates The Lookout and Base Camp');
  r = await call('/api/seed', { method: 'POST', body: { token: 'seed-me-once', connor_code: 'AGAIN123', kushman_code: 'AGAIN456' }, ip: '1.1.1.2' });
  assert(r.status === 409, 'seed refuses once forts exist');
  // bootstrap routes are ip-throttled: the first ip already spent 4 of its 5 tries
  r = await call('/api/seed', { method: 'POST', body: { token: 'wrong', connor_code: 'X', kushman_code: 'Y' } });
  r = await call('/api/seed', { method: 'POST', body: { token: 'wrong', connor_code: 'X', kushman_code: 'Y' } });
  assert(r.status === 429, 'bootstrap routes rate-limit per ip, got ' + r.status);
  console.log('seed: OK');

  r = await call('/the_lookout/api/state');
  assert(r.status === 401, 'the_lookout exists and asks for a knock');
  r = await call('/base_camp/api/state');
  assert(r.status === 401, 'base_camp exists and asks for a knock');
  r = await call('/the_lookout/paint');
  assert(r.status === 200, 'fort room route serves through Worker');
  r = await call('/The_Lookout/api/state');
  assert(r.status === 308 && r.location === 'https://treefort.lol/the_lookout/api/state', 'fort lookup is case-insensitive with canonical redirect');
  r = await call('/Base_Camp');
  assert(r.status === 308 && r.location === 'https://treefort.lol/base_camp/', 'Base_Camp resolves canonically to base_camp');
  r = await call('/api/forts/create', { method: 'POST', body: { token: 'seed-me-once', display_name: 'Base Camp', founder_handle: 'KUSHMAN', founder_code: 'SOMECODE' }, ip: '1.1.1.3' });
  assert(r.status === 409, 'same normalized fort slug cannot be claimed twice');
  r = await call('/api/forts/create', { method: 'POST', body: { token: 'seed-me-once', display_name: 'Something Else', slug: 'BASE_CAMP', founder_handle: 'KUSHMAN', founder_code: 'SOMECODE' }, ip: '1.1.1.4' });
  assert(r.status === 409, 'same slug with different case cannot be claimed twice');
  console.log('fort routing: OK');

  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'dadcode1', name: 'CONNOR' }, ip: '2.2.2.2', who: 'lookoutKushman' });
  assert(r.data.ok && r.data.role === 'member' && r.data.name === 'KUSHMAN' && r.data.fort_slug === 'the_lookout', 'KUSHMAN is a member in The Lookout');
  r = await call('/base_camp/api/knock', { method: 'POST', body: { code: 'dadcode1' }, ip: '2.2.2.3', who: 'baseWrongOldCode' });
  assert(r.status === 401, 'Lookout KUSHMAN knock does not open Base Camp when a separate Base Camp code is set');
  r = await call('/base_camp/api/knock', { method: 'POST', body: { code: 'BASECAMP1' }, ip: '2.2.2.4', who: 'baseKushman' });
  assert(r.data.ok && r.data.role === 'founder' && r.data.name === 'KUSHMAN' && r.data.fort_slug === 'base_camp', 'separate Base Camp code works for KUSHMAN founder');
  r = await call('/base_camp/api/state', { who: 'baseKushman' });
  assert(r.data.ok && r.data.fort_name === 'Base Camp', 'session carries fort identity');
  r = await call('/base_camp/api/state', { who: 'lookoutKushman' });
  assert(r.status === 401, 'Lookout session cannot be reused in Base Camp');
  console.log('per-fort knocks: OK');

  r = await call('/the_lookout/handbook.html', { who: 'lookoutKushman' });
  assert(r.status === 404, 'handbook hidden from members (KUSHMAN is not a Lookout founder)');
  r = await call('/base_camp/handbook.html', { who: 'baseKushman' });
  assert(r.status === 200, 'handbook open to a fort\'s own founder (Base Camp founder reads it too)');
  r = await call('/the_lookout/handbook.html');
  assert(r.status === 404, 'handbook hidden with no session at all');

  db.members.get(memberKey('the_lookout', 'CONNOR')).is_founder = 0;
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'FOUNDER1' }, ip: '3.3.3.2', who: 'staleconnor' });
  assert(r.data.ok && r.data.name === 'CONNOR' && r.data.role === 'member', 'made a stale non-founder Connor cookie');
  db.members.get(memberKey('the_lookout', 'CONNOR')).is_founder = 1;
  r = await call('/the_lookout/api/state', { who: 'staleconnor' });
  assert(r.data.ok && r.data.name === 'CONNOR' && r.data.role === 'founder', 'session role follows the live roster');
  r = await call('/the_lookout/handbook.html', { who: 'staleconnor' });
  assert(r.status === 200, 'handbook visible after live roster upgrades Connor in The Lookout');
  console.log('handbook gate: OK');

  for (let i = 0; i < 5; i++) {
    r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'WRONG' + i }, ip: '6.6.6.6' });
    assert(r.status === 401, 'wrong knock 401');
  }
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'FOUNDER1' }, ip: '6.6.6.6' });
  assert(r.status === 423 && r.data.cooldown > 0, 'cooldown locks only that fort');
  r = await call('/base_camp/api/knock', { method: 'POST', body: { code: 'BASECAMP1' }, ip: '6.6.6.6', who: 'baseAfterLookoutFails' });
  assert(r.data.ok && r.data.fort_slug === 'base_camp', 'Lookout knock failures do not poison Base Camp');
  console.log('knock cooldown scoping: OK');

  r = await call('/the_lookout/api/post', { method: 'POST', body: { type: 'text', text: 'first. historic.' }, who: 'lookoutKushman' });
  assert(r.data.ok, 'Lookout text post');
  r = await call('/the_lookout/api/post', { method: 'POST', body: { type: 'text', text: '   ' }, who: 'lookoutKushman' });
  assert(r.status === 400, 'empty post rejected');
  r = await call('/the_lookout/api/reply', { method: 'POST', body: { post_id: 1, text: 'W' }, who: 'lookoutKushman' });
  assert(r.data.ok, 'reply works');
  r = await call('/the_lookout/api/wall', { who: 'lookoutKushman' });
  assert(r.data.posts.length === 1 && r.data.posts[0].author === 'KUSHMAN' && r.data.posts[0].replies[0].text === 'W', 'Lookout wall stamps the session handle');
  r = await call('/base_camp/api/post', { method: 'POST', body: { type: 'text', text: 'base camp first post.' }, who: 'baseKushman' });
  assert(r.data.ok, 'Base Camp founder can post');
  r = await call('/base_camp/api/wall', { who: 'baseKushman' });
  assert(r.data.posts.length === 1 && r.data.posts[0].text === 'base camp first post.', 'Base Camp wall is separate');
  r = await call('/the_lookout/api/wall', { who: 'lookoutKushman' });
  assert(r.data.posts.length === 1 && r.data.posts[0].text === 'first. historic.', 'Base Camp post does not appear in The Lookout');
  console.log('wall scoping: OK');

  r = await call('/the_lookout/api/delete', { method: 'POST', body: { post_id: 1 }, who: 'lookoutKushman' });
  assert(r.status === 403, 'Lookout member cannot delete');

  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'FOUNDER1' }, ip: '3.3.3.3', who: 'connor' });
  assert(r.data.role === 'founder' && r.data.name === 'CONNOR', 'Connor founder knock');
  r = await call('/the_lookout/api/upload', { method: 'POST', raw: png(), who: 'connor' });
  assert(r.data.ok && r.data.media_key.startsWith('m/'), 'png upload');
  const mk = r.data.media_key;
  r = await call('/the_lookout/api/post', { method: 'POST', body: { type: 'painting', media_key: mk, text: 'my masterpiece' }, who: 'connor' });
  assert(r.data.ok, 'painting post');
  r = await call('/the_lookout/api/media/' + mk, { who: 'connor' });
  assert(r.status === 200, 'fort media can be fetched after it is posted');
  r = await call('/base_camp/api/post', { method: 'POST', body: { type: 'image', media_key: mk, text: 'borrowed' }, who: 'baseKushman' });
  assert(r.status === 403, 'another fort cannot attach a known media key');
  r = await call('/base_camp/api/media/' + mk, { who: 'baseKushman' });
  assert(r.status === 404, 'fort media is not exposed through another fort');
  console.log('uploads + media scoping: OK');

  r = await call('/the_lookout/api/delete', { method: 'POST', body: { post_id: 3 }, who: 'connor' });
  assert(r.data.ok, 'founder delete');
  r = await call('/the_lookout/api/wall', { who: 'lookoutKushman' });
  const tomb = r.data.posts.find(p => p.id === 3);
  assert(tomb.deleted === true && !tomb.media_key, 'tombstone in Lookout wall');
  console.log('tombstone: OK');

  r = await call('/the_lookout/api/dict', { method: 'POST', body: { term: 'rizz', def: 'charisma, allegedly', example: 'he has zero rizz' }, who: 'lookoutKushman' });
  assert(r.data.ok, 'dict add');
  r = await call('/the_lookout/api/dict/status', { method: 'POST', body: { id: 1, status: 'CERTIFIED' }, who: 'lookoutKushman' });
  assert(r.status === 403, 'member cannot chip');
  r = await call('/the_lookout/api/dict/status', { method: 'POST', body: { id: 1, status: 'DECEASED' }, who: 'connor' });
  assert(r.data.ok, 'founder chips');
  r = await call('/base_camp/api/dict', { who: 'baseKushman' });
  assert(r.data.terms.length === 0, 'dictionary terms are scoped to their fort');
  console.log('dictionary scoping: OK');

  r = await call('/the_lookout/api/config', { method: 'POST', body: { fort_name: 'Megafort', dog_name: 'beans' }, who: 'connor' });
  assert(r.data.ok, 'config rename');
  r = await call('/the_lookout/api/state', { who: 'connor' });
  assert(r.data.fort_name === 'Megafort' && r.data.dog_name === 'BEANS', 'display name capitalization is preserved exactly');
  r = await call('/base_camp/api/state', { who: 'baseKushman' });
  assert(r.data.fort_name === 'Base Camp' && r.data.dog_name === 'DALE', 'renaming The Lookout does not rename Base Camp');
  console.log('founder config scoping: OK');

  r = await call('/the_lookout/api/mycode', { method: 'POST', body: { current_code: 'WRONGCUR', new_code: 'NEWDAD01' }, who: 'lookoutKushman' });
  assert(r.status === 400, 'wrong current knock rejected');
  r = await call('/the_lookout/api/mycode', { method: 'POST', body: { current_code: 'DADCODE1', new_code: 'NEWDAD01' }, who: 'lookoutKushman' });
  assert(r.data.ok, 'own knock changed inside The Lookout');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'DADCODE1' }, ip: '2.2.2.9', who: 'ghost' });
  assert(r.status === 401, 'old Lookout knock is dead');
  r = await call('/base_camp/api/knock', { method: 'POST', body: { code: 'BASECAMP1' }, ip: '2.2.2.10', who: 'baseStillOwnCode' });
  assert(r.data.ok && r.data.role === 'founder', 'changing Lookout KUSHMAN code does not change Base Camp KUSHMAN code');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'NEWDAD01' }, ip: '2.2.2.8', who: 'lookoutKushman2' });
  assert(r.data.ok && r.data.name === 'KUSHMAN', 'new Lookout knock lives, same handle');
  console.log('change my knock scoping: OK');

  r = await call('/the_lookout/api/members/add', { method: 'POST', body: { handle: 'jamie', code: 'JAMIE001' }, who: 'lookoutKushman2' });
  assert(r.status === 403, 'member cannot add members');
  r = await call('/the_lookout/api/members/add', { method: 'POST', body: { handle: 'JAMIE', code: 'JAMIE001' }, who: 'connor' });
  assert(r.data.ok, 'founder adds member');
  r = await call('/the_lookout/api/members/add', { method: 'POST', body: { handle: 'JAMIE', code: 'OTHER001' }, who: 'connor' });
  assert(r.status === 400, 'duplicate handle rejected within fort');
  r = await call('/base_camp/api/members/add', { method: 'POST', body: { handle: 'JAMIE', code: 'JAMIE001' }, who: 'baseKushman' });
  assert(r.data.ok, 'same handle and code may exist in another fort');
  r = await call('/the_lookout/api/members/add', { method: 'POST', body: { handle: 'DALE', code: 'JAMIE001' }, who: 'connor' });
  assert(r.status === 400, 'duplicate code rejected within fort');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'JAMIE001' }, ip: '4.4.4.4', who: 'jamie' });
  assert(r.data.ok && r.data.role === 'member' && r.data.name === 'JAMIE', 'new member can knock in');
  console.log('add member scoping: OK');

  r = await call('/the_lookout/api/members/reset', { method: 'POST', body: { handle: 'JAMIE', code: 'JAMIE999' }, who: 'lookoutKushman2' });
  assert(r.status === 403, 'member cannot reset');
  r = await call('/the_lookout/api/members/reset', { method: 'POST', body: { handle: 'NOBODY', code: 'JAMIE999' }, who: 'connor' });
  assert(r.status === 404, 'reset unknown handle 404');
  r = await call('/the_lookout/api/members/reset', { method: 'POST', body: { handle: 'JAMIE', code: 'JAMIE999' }, who: 'connor' });
  assert(r.data.ok, 'founder resets a knock');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'JAMIE001' }, ip: '4.4.4.5', who: 'x' });
  assert(r.status === 401, 'reset killed the old Lookout knock');
  r = await call('/base_camp/api/knock', { method: 'POST', body: { code: 'JAMIE001' }, ip: '4.4.4.7', who: 'baseJamie' });
  assert(r.data.ok && r.data.name === 'JAMIE', 'reset in The Lookout did not reset Base Camp JAMIE');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'JAMIE999' }, ip: '4.4.4.6', who: 'jamie2' });
  assert(r.data.ok && r.data.name === 'JAMIE', 'new Lookout knock works after reset');
  console.log('reset knock scoping: OK');

  r = await call('/the_lookout/api/members', { who: 'lookoutKushman2' });
  assert(r.status === 403, 'member cannot list members');
  r = await call('/the_lookout/api/members', { who: 'connor' });
  assert(r.data.ok && r.data.members.length === 3 && r.data.members[0].handle === 'CONNOR' && r.data.members[0].is_founder === 1, 'Lookout members list, founder first');
  assert(!('code_hash' in r.data.members[0]), 'members list never leaks a hash');
  r = await call('/base_camp/api/members', { who: 'baseKushman' });
  assert(r.data.members.some(m => m.handle === 'KUSHMAN' && m.is_founder === 1) && r.data.members.some(m => m.handle === 'JAMIE'), 'Base Camp has its own roster');
  r = await call('/the_lookout/api/roster', { who: 'connor' });
  assert(r.data.roster.some(v => v.name === 'KUSHMAN') && !r.data.roster.some(v => v.fort_id !== 'the_lookout'), 'Lookout knock log is scoped');
  console.log('roster scoping: OK');

  let hit429 = false;
  for (let i = 0; i < 12; i++) {
    r = await call('/the_lookout/api/post', { method: 'POST', body: { type: 'text', text: 'spam ' + i }, who: 'connor' });
    if (r.status === 429) { hit429 = true; break; }
  }
  assert(hit429, 'post rate limit engages');
  console.log('rate limit: OK');

  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'FOUNDER1' }, ip: '7.7.7.7', who: 'leaver' });
  assert(r.data.ok, 'leaver knock');
  r = await call('/the_lookout/api/state', { who: 'leaver' });
  assert(r.status === 200 && r.data.ok, 'leaver has a live session');
  r = await call('/the_lookout/api/logout', { method: 'POST', who: 'leaver' });
  assert(r.data.ok, 'logout ok');
  r = await call('/the_lookout/api/state', { who: 'leaver' });
  assert(r.status === 401, 'after logout the fort session is gone, got ' + r.status);
  console.log('logout: OK');

  // knock and logout both retire the single-fort-era Path=/ cookie
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'FOUNDER1' }, ip: '7.7.7.8', who: 'legacyclear' });
  assert(r.setCookies.length === 2 && r.setCookies.some(c => c.includes('Path=/;') && c.includes('Max-Age=0')),
    'knock also clears the legacy Path=/ cookie');
  r = await call('/the_lookout/api/logout', { method: 'POST', who: 'legacyclear' });
  assert(r.setCookies.length === 2 && r.setCookies.some(c => c.includes('Path=/;') && c.includes('Max-Age=0')),
    'logout also clears the legacy Path=/ cookie');
  console.log('legacy cookie clear: OK');

  // changing your knock is a guessing oracle without a limiter
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'FOUNDER1' }, ip: '7.7.7.9', who: 'guesser' });
  assert(r.data.ok, 'guesser knocked in');
  let hitMycode429 = false;
  for (let i = 0; i < 7; i++) {
    r = await call('/the_lookout/api/mycode', { method: 'POST', body: { current_code: 'GUESS' + i, new_code: 'WHATEVER1' }, who: 'guesser' });
    if (r.status === 429) { hitMycode429 = true; break; }
  }
  assert(hitMycode429, 'mycode rate limit stops current-code guessing');
  console.log('mycode limiter: OK');

  // a browser hitting a bad fort gets a sign on the tree, not raw json
  r = await call('/tree_mansion/', { accept: 'text/html' });
  assert(r.status === 404, 'bad fort is 404');
  const badFortBody = await r.res.text();
  assert(badFortBody.includes('wrong branch') && badFortBody.toLowerCase().includes('<!doctype html>'),
    'bad fort page is html with the sign on the tree');
  r = await call('/tree_mansion/api/state');
  assert(r.status === 404 && r.data && r.data.error, 'bad fort api path stays json');
  console.log('friendly 404: OK');

  // a D1 face-plant returns one deadpan sentence, not a stack trace
  const realPrepare = env.DB.prepare;
  env.DB.prepare = () => { throw new Error('secret stack detail: the filing cabinet exploded'); };
  r = await call('/the_lookout/api/state', { who: 'connor' });
  assert(r.status === 500 && r.data && r.data.error && !JSON.stringify(r.data).includes('filing cabinet exploded'),
    'internal errors are deadpan and leak nothing, got ' + r.status);
  env.DB.prepare = realPrepare;
  console.log('graceful failure: OK');

  console.log('\nTHE MULTI-FORT FOUNDATION WORKS. ALL ASSERTIONS PASSED.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
