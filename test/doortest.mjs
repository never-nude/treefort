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
  members: new Map(),
  grants: [],
  agreements: [],
  reports: []
};
let postId = 0, replyId = 0, termId = 0, grantId = 0, agreementId = 0, reportId = 0;

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
      if (S.startsWith('SELECT * FROM grants WHERE token_hash=?')) {
        return db.grants.find(g => g.token_hash === args[0]) || null;
      }
      if (S.startsWith('SELECT COUNT(*) AS n FROM grants WHERE granted_by_fort=? AND used_at IS NULL')) {
        return { n: db.grants.filter(g => g.granted_by_fort === args[0] && g.used_at == null).length };
      }
      if (S.startsWith('SELECT MAX(created_at) AS t FROM grants WHERE granted_by_fort=?')) {
        const ts = db.grants.filter(g => g.granted_by_fort === args[0]).map(g => g.created_at);
        return { t: ts.length ? Math.max(...ts) : null };
      }
      if (S.startsWith('SELECT id FROM agreements WHERE fort_id=? AND handle=? AND rules_version=?')) {
        const a = db.agreements.find(a => a.fort_id === args[0] && a.handle === args[1] && a.rules_version === args[2]);
        return a ? { id: a.id } : null;
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
      if (S.startsWith('SELECT id, note, created_at, used_at, used_by_fort FROM grants WHERE granted_by_fort=?')) {
        return { results: db.grants.filter(g => g.granted_by_fort === args[0])
          .map(g => ({ id: g.id, note: g.note, created_at: g.created_at, used_at: g.used_at, used_by_fort: g.used_by_fort }))
          .sort((a, b) => b.id - a.id) };
      }
      throw new Error('all? ' + S);
    },
    async run() {
      if (S.startsWith('INSERT INTO config')) {
        db.config = { id: 1, gen: 1, salt: args[0], fort_hash: args[1], founder_hash: args[2], fort_name: 'TREEFORT', dog_name: 'DALE' };
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO forts (id, slug, display_name, dog_name, gen, salt, created_at, parent_fort, founded_by_grant, companion_kind)')) {
        if (db.forts.has(args[0])) throw new Error('UNIQUE constraint failed: forts.slug');
        db.forts.set(args[0], {
          id: args[0], slug: args[1], display_name: args[2], dog_name: args[3],
          gen: 1, salt: args[4], created_at: args[5], renamed_at: null,
          parent_fort: args[6], founded_by_grant: args[7], companion_kind: args[8], frozen: 0
        });
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
          renamed_at: null,
          parent_fort: null, founded_by_grant: null, companion_kind: 'dog', frozen: 0
        });
        return { meta: {} };
      }
      if (S.startsWith('INSERT INTO grants')) {
        const g = { id: ++grantId, token_hash: args[0], granted_by_fort: args[1], granted_by_handle: args[2], note: args[3], created_at: args[4], used_at: null, used_by_fort: null };
        db.grants.push(g);
        return { meta: { last_row_id: g.id } };
      }
      if (S.startsWith('UPDATE grants SET used_at=?, used_by_fort=? WHERE id=? AND used_at IS NULL')) {
        const g = db.grants.find(g => g.id === args[2] && g.used_at == null);
        if (g) { g.used_at = args[0]; g.used_by_fort = args[1]; }
        return { meta: { changes: g ? 1 : 0 } };
      }
      if (S.startsWith('UPDATE grants SET used_at=NULL')) {
        const g = db.grants.find(g => g.id === args[0]);
        if (g) { g.used_at = null; g.used_by_fort = null; }
        return { meta: { changes: g ? 1 : 0 } };
      }
      if (S.startsWith('DELETE FROM grants WHERE id=? AND granted_by_fort=? AND used_at IS NULL')) {
        const i = db.grants.findIndex(g => g.id === args[0] && g.granted_by_fort === args[1] && g.used_at == null);
        if (i >= 0) db.grants.splice(i, 1);
        return { meta: { changes: i >= 0 ? 1 : 0 } };
      }
      if (S.startsWith('INSERT INTO agreements')) {
        const a = { id: ++agreementId, fort_id: args[0], handle: args[1], rules_version: args[2], agreed_at: args[3] };
        db.agreements.push(a);
        return { meta: { last_row_id: a.id } };
      }
      if (S.startsWith('INSERT INTO reports')) {
        const rp = { id: ++reportId, fort_id: args[0], page: args[1], reason: args[2], contact: args[3], created_at: args[4], ip: args[5] };
        db.reports.push(rp);
        return { meta: { last_row_id: rp.id } };
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
      if (S.startsWith('UPDATE members SET code_hash=?, code_changed_at=? WHERE fort_id=? AND handle=?')) {
        const m = db.members.get(memberKey(args[2], args[3]));
        if (m) { m.code_hash = args[0]; m.code_changed_at = args[1]; }
        return { meta: {} };
      }
      if (S.startsWith('UPDATE members SET spare_hash=?, spare_issued_at=? WHERE fort_id=? AND handle=?')) {
        const m = db.members.get(memberKey(args[2], args[3]));
        if (m) { m.spare_hash = args[0]; m.spare_issued_at = args[1]; }
        return { meta: {} };
      }
      if (S.startsWith('UPDATE members SET code_hash=?, spare_hash=NULL, spare_issued_at=NULL, code_changed_at=? WHERE fort_id=? AND handle=?')) {
        const m = db.members.get(memberKey(args[2], args[3]));
        if (m) { m.code_hash = args[0]; m.spare_hash = null; m.spare_issued_at = null; m.code_changed_at = args[1]; }
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
  assert(r.status === 200, 'root serves the grove, got ' + r.status);
  r = await call('/plant');
  assert(r.status === 200, 'the department of new forts is open');
  r = await call('/rules');
  assert(r.status === 200, 'the sign is readable without knocking');

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

  // the whole fort is carved at the founding — name, slug, AND staff. config is a tombstone.
  r = await call('/the_lookout/api/config', { method: 'POST', body: { fort_name: 'Megafort' }, who: 'connor' });
  assert(r.status === 410 && /carved/.test(r.data.error), 'fort name is carved, even for the founder');
  r = await call('/the_lookout/api/config', { method: 'POST', body: { dog_name: 'beans' }, who: 'connor' });
  assert(r.status === 410, 'the staff name is carved too — the config endpoint is gone entirely');
  r = await call('/the_lookout/api/state', { who: 'connor' });
  assert(r.data.fort_name === 'The Lookout' && r.data.dog_name === 'DALE', 'nothing renamed, ever');
  assert(db.forts.get('the_lookout').slug === 'the_lookout', 'slug never moved');
  console.log('carved forts (no config endpoint): OK');

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

  // founder resets are gone: whoever can re-key you can BE you, and nobody gets to be you
  r = await call('/the_lookout/api/members/reset', { method: 'POST', body: { handle: 'JAMIE', code: 'JAMIE999' }, who: 'connor' });
  assert(r.status === 410 && /not even the founder/.test(r.data.error), 'founder reset is dead, even for the founder');
  console.log('no more founder resets: OK');

  /* THE SPARE KEY — self-service recovery for lost/stolen/forgotten knocks */
  r = await call('/the_lookout/api/spare/cut', { method: 'POST', who: 'lookoutKushman2' });
  assert(r.data.ok && /^SPARE-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.data.spare), 'a member cuts a spare: ' + (r.data.spare || r.data.error));
  const kushmanSpare = r.data.spare;
  r = await call('/the_lookout/api/state', { who: 'lookoutKushman2' });
  assert(r.data.spare_ready === true, 'state knows the spare exists (never what it says)');
  // wrong spare, wrong handle: one uniform answer, no session needed
  r = await call('/the_lookout/api/spare/use', { method: 'POST', body: { handle: 'KUSHMAN', spare: 'SPARE-XXXX-XXXX', new_code: 'FRESH123' }, ip: '4.5.6.1' });
  assert(r.status === 403 && /doesn't fit/.test(r.data.error), 'wrong spare gets the uniform no');
  r = await call('/the_lookout/api/spare/use', { method: 'POST', body: { handle: 'NOBODY', spare: kushmanSpare, new_code: 'FRESH123' }, ip: '4.5.6.1' });
  assert(r.status === 403 && /doesn't fit/.test(r.data.error), 'wrong handle gets the same uniform no');
  // the real thing: dashes optional, case-insensitive, walks you in re-keyed
  r = await call('/the_lookout/api/spare/use', { method: 'POST',
    body: { handle: 'kushman', spare: kushmanSpare.toLowerCase().replace(/-/g, ''), new_code: 'SPARENEW1' }, ip: '4.5.6.2', who: 'recovered' });
  assert(r.data.ok && r.data.name === 'KUSHMAN' && r.data.spare_ready === false, 'the spare fits: ' + JSON.stringify(r.data.error || r.data.name));
  assert(cookies.recovered && cookies.recovered.path === '/the_lookout', 'recovery walks you in with a live session');
  r = await call('/the_lookout/api/spare/use', { method: 'POST', body: { handle: 'KUSHMAN', spare: kushmanSpare, new_code: 'AGAIN999' }, ip: '4.5.6.3' });
  assert(r.status === 403, 'a spare only works once');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'NEWDAD01' }, ip: '4.5.6.4' });
  assert(r.status === 401, 'the old (stolen) knock is dead');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'SPARENEW1' }, ip: '4.5.6.5', who: 'lookoutKushman2' });
  assert(r.data.ok && r.data.name === 'KUSHMAN', 'the fresh knock lives');
  // re-keying kills sessions issued before it — the thief's stolen cookie dies too
  const km = db.members.get(memberKey('the_lookout', 'KUSHMAN'));
  assert(km.code_changed_at > 0, 'the re-keying moment is recorded');
  const savedCca = km.code_changed_at;
  km.code_changed_at = Math.floor(Date.now() / 1000) + 5;   // simulate a token issued before the change
  r = await call('/the_lookout/api/state', { who: 'recovered' });
  assert(r.status === 401, 'sessions issued before the re-keying are dead');
  km.code_changed_at = savedCca - 100;                      // restore for downstream tests
  // a spare is fort-bound: cut a fresh one in The Lookout, try it on Base Camp
  r = await call('/the_lookout/api/spare/cut', { method: 'POST', who: 'lookoutKushman2' });
  const lookoutSpare = r.data.spare;
  r = await call('/base_camp/api/spare/use', { method: 'POST', body: { handle: 'KUSHMAN', spare: lookoutSpare, new_code: 'CROSSFORT1' }, ip: '4.5.6.6' });
  assert(r.status === 403 && /doesn't fit/.test(r.data.error), 'a Lookout spare opens nothing at Base Camp, even for the same person');
  // a kicked-out member's spare is as dead as their knock
  km.revoked = 1;
  r = await call('/the_lookout/api/spare/use', { method: 'POST', body: { handle: 'KUSHMAN', spare: lookoutSpare, new_code: 'SNEAKY111' }, ip: '4.5.6.7' });
  assert(r.status === 403 && /doesn't fit/.test(r.data.error), 'kicked out of the tree = the spare means nothing either');
  km.revoked = 0;
  // a sealed fort seals its flowerpot too
  db.forts.get('the_lookout').frozen = 1;
  r = await call('/the_lookout/api/spare/use', { method: 'POST', body: { handle: 'KUSHMAN', spare: lookoutSpare, new_code: 'SEALED111' }, ip: '4.5.6.8' });
  assert(r.status === 403 && r.data.sealed, 'the seal covers spare recovery — no side doors');
  db.forts.get('the_lookout').frozen = 0;
  console.log('the spare key: OK');

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

  /* ================= PHASE 3: THE TREE GROWS ================= */

  // saplings: founder mints, member cannot, one a day, nursery caps at 5
  r = await call('/the_lookout/api/grants/mint', { method: 'POST', body: { note: 'for dylan' }, who: 'lookoutKushman2' });
  assert(r.status === 403, 'members cannot mint saplings');
  r = await call('/the_lookout/api/grants/mint', { method: 'POST', body: { note: 'for dylan' }, who: 'connor' });
  assert(r.data.ok && /^SAPLING-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.data.token), 'founder mints a sapling: ' + (r.data.token || r.data.error));
  const sapling1 = r.data.token;
  // the soil takes a day between saplings
  r = await call('/the_lookout/api/grants/mint', { method: 'POST', body: {}, who: 'connor' });
  assert(r.status === 429 && /one sapling a day/.test(r.data.error), 'the nursery grows one a day: ' + (r.data.error || '?'));
  // grow four more, one simulated day apart, to fill the nursery
  for (let i = 0; i < 4; i++) {
    db.grants.forEach(g => { g.created_at -= 86400 + 60; });   // yesterday, all of it
    r = await call('/the_lookout/api/grants/mint', { method: 'POST', body: {}, who: 'connor' });
    assert(r.data.ok, 'day-later mint #' + (i + 2) + ' works: ' + (r.data.error || 'ok'));
  }
  db.grants.forEach(g => { g.created_at -= 86400 + 60; });
  r = await call('/the_lookout/api/grants/mint', { method: 'POST', body: {}, who: 'connor' });
  assert(r.status === 429 && /nursery is full/.test(r.data.error), 'nursery caps at 5 unused even a day later');
  r = await call('/the_lookout/api/grants', { who: 'connor' });
  assert(r.data.ok && r.data.grants.length === 5 && !JSON.stringify(r.data).includes('token'), 'grant list shows status, never tokens');
  const compostId = r.data.grants[0].id;
  r = await call('/the_lookout/api/grants/revoke', { method: 'POST', body: { id: compostId }, who: 'connor' });
  assert(r.data.ok, 'composting works');
  console.log('saplings: OK');

  // founding: bad stick, name check, reserved, the ceremony itself
  r = await call('/api/found', { method: 'POST', body: { token: 'SAPLING-WRONG-ONES', fort_name: 'North Fort', check: true }, ip: '9.9.9.1' });
  assert(r.status === 403 && /stick/.test(r.data.error), 'a stick is not a sapling');
  r = await call('/api/found', { method: 'POST', body: { token: sapling1, fort_name: 'The Lookout', check: true }, ip: '9.9.9.1' });
  assert(r.status === 409 && r.data.taken && r.data.issued.slug === 'the_lookout_2', 'taken name offers the 2: ' + JSON.stringify(r.data.issued));
  r = await call('/api/found', { method: 'POST', body: { token: sapling1, fort_name: 'Admin', check: true }, ip: '9.9.9.1' });
  assert(r.status === 400 && r.data.reserved, 'reserved names are refused, never numbered');
  r = await call('/api/found', { method: 'POST', body: { token: sapling1, fort_name: 'North Fort', check: true }, ip: '9.9.9.1' });
  assert(r.data.ok && r.data.free && r.data.slug === 'north_fort', 'free name confirmed');
  r = await call('/api/found', { method: 'POST', body: { token: sapling1, fort_name: 'North Fort', companion_kind: 'raccoon', companion_name: 'BANDIT', handle: 'DYLAN', code: 'DYLAN123', agree: true }, ip: '9.9.9.1' });
  assert(r.status === 400 && /write-ins/.test(r.data.error), 'raccoon is not on the ballot');
  r = await call('/api/found', { method: 'POST', body: { token: sapling1, fort_name: 'North Fort', companion_kind: 'moth', companion_name: 'LAMP', handle: 'DYLAN', code: 'DYLAN123' }, ip: '9.9.9.1' });
  assert(r.status === 400 && /rules/.test(r.data.error), 'no founding without knocking the sign');
  r = await call('/api/found', { method: 'POST', body: { token: sapling1, fort_name: 'North Fort', companion_kind: 'moth', companion_name: 'LAMP', handle: 'DYLAN', code: 'DYLAN123', agree: true }, ip: '9.9.9.1', who: 'dylan' });
  assert(r.data.ok && r.data.slug === 'north_fort', 'the ceremony founds the fort: ' + JSON.stringify(r.data));
  assert(cookies.dylan && cookies.dylan.path === '/north_fort', 'founder lands inside their new fort');
  r = await call('/north_fort/api/state', { who: 'dylan' });
  assert(r.data.ok && r.data.role === 'founder' && r.data.companion_kind === 'moth' && r.data.dog_name === 'LAMP' && r.data.agreed === true,
    'new fort state: moth named LAMP, rules already knocked: ' + JSON.stringify(r.data));
  r = await call('/api/found', { method: 'POST', body: { token: sapling1, fort_name: 'South Fort', companion_kind: 'cat', companion_name: 'DUKE', handle: 'DYLAN', code: 'DYLAN123', agree: true }, ip: '9.9.9.2' });
  assert(r.status === 403 && /already grew/.test(r.data.error), 'one sapling, one fort, forever');
  const lineage = db.grants.find(g => g.used_by_fort === 'north_fort');
  assert(lineage && lineage.granted_by_fort === 'the_lookout' && db.forts.get('north_fort').parent_fort === 'the_lookout',
    'the chain records who vouched');
  console.log('founding: OK');

  // the rules knock for pre-existing members
  r = await call('/the_lookout/api/state', { who: 'connor' });
  assert(r.data.agreed === false, 'old members have not knocked the new sign yet');
  r = await call('/the_lookout/api/agree', { method: 'POST', who: 'connor' });
  assert(r.data.ok, 'the sign accepts the knock');
  r = await call('/the_lookout/api/state', { who: 'connor' });
  assert(r.data.agreed === true, 'the logbook remembers');
  console.log('the rules: OK');

  // speak to the management: no session needed, rate limited, stored
  r = await call('/api/report', { method: 'POST', body: { reason: 'a post on the wall worries me', fort: 'The Lookout', contact: 'a parent, 555-0100' }, ip: '8.8.8.8' });
  assert(r.data.ok && /not the dog/.test(r.data.note), 'a stranger can speak to the management');
  assert(db.reports.length === 1 && db.reports[0].fort_id === 'the_lookout', 'the report is on file');
  await call('/api/report', { method: 'POST', body: { reason: 'two' }, ip: '8.8.8.8' });
  await call('/api/report', { method: 'POST', body: { reason: 'three' }, ip: '8.8.8.8' });
  r = await call('/api/report', { method: 'POST', body: { reason: 'four' }, ip: '8.8.8.8' });
  assert(r.status === 429, 'the mailbox rate-limits per ip');
  console.log('speak to the management: OK');

  // the seal: freeze covers pages, api, AND media
  db.forts.get('north_fort').frozen = 1;
  r = await call('/north_fort/', { who: 'dylan', accept: 'text/html' });
  assert(r.status === 403, 'sealed fort page is sealed');
  r = await call('/north_fort/api/wall', { who: 'dylan' });
  assert(r.status === 403 && r.data.sealed, 'sealed fort api is sealed');
  r = await call('/north_fort/api/media/m/anything', { who: 'dylan' });
  assert(r.status === 403, 'sealed fort media is sealed — no side doors');
  db.forts.get('north_fort').frozen = 0;
  r = await call('/north_fort/api/state', { who: 'dylan' });
  assert(r.data.ok, 'unsealing restores everything untouched');
  console.log('the seal: OK');

  // kicked out of the tree: session dies, code dies, record survives, no re-add
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'SPARENEW1' }, ip: '5.5.5.5', who: 'kicked' });
  assert(r.data.ok && r.data.name === 'KUSHMAN', 'kushman knocks in before the kicking');
  db.members.get(memberKey('the_lookout', 'KUSHMAN')).revoked = 1;
  r = await call('/the_lookout/api/state', { who: 'kicked' });
  assert(r.status === 401, 'revoked = the session means nothing');
  r = await call('/the_lookout/api/knock', { method: 'POST', body: { code: 'SPARENEW1' }, ip: '5.5.5.6' });
  assert(r.status === 401, 'revoked = the code means nothing');
  assert(db.members.get(memberKey('the_lookout', 'KUSHMAN')), 'the record survives the kicking');
  r = await call('/the_lookout/api/members/add', { method: 'POST', body: { handle: 'KUSHMAN', code: 'SNEAKY99' }, who: 'connor' });
  assert(r.status === 409 && /stays out/.test(r.data.error), 'a kicked name cannot be quietly re-added');
  db.members.get(memberKey('the_lookout', 'KUSHMAN')).revoked = 0;
  console.log('kicked out of the tree: OK');

  console.log('\nTHE MULTI-FORT FOUNDATION WORKS. THE TREE GROWS. ALL ASSERTIONS PASSED.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
