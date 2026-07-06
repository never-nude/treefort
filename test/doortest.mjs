import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const worker = (await import(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worker.js'))).default;

/* ---- in-memory D1 stub (pattern-matched to the worker's queries) ---- */
const db = { config: null, posts: [], replies: [], terms: [], visits: new Map(), fails: new Map(), members: new Map() };
let postId = 0, replyId = 0, termId = 0;
function prepare(sql) {
  return { bind(...args){ return exec(sql, args); }, ...exec(sql, []) };
}
function exec(sql, args) {
  const S = sql.replace(/\s+/g,' ').trim();
  return {
    bind(...a){ return exec(sql, a); },
    async first(){
      if (S.startsWith('SELECT * FROM config')) return db.config;
      if (S.startsWith('SELECT * FROM knock_fails')) return db.fails.get(args[0]) || null;
      if (S.startsWith('SELECT id, deleted FROM posts')) { const p=db.posts.find(p=>p.id===args[0]); return p?{id:p.id,deleted:p.deleted}:null; }
      if (S.startsWith('SELECT * FROM members WHERE code_hash=?')) return [...db.members.values()].find(m=>m.code_hash===args[0]) || null;
      if (S.startsWith('SELECT * FROM members WHERE handle=?')) return db.members.get(args[0]) || null;
      if (S.startsWith('SELECT handle FROM members WHERE code_hash=?')) { const m=[...db.members.values()].find(m=>m.code_hash===args[0]); return m?{handle:m.handle}:null; }
      if (S.startsWith('SELECT handle FROM members WHERE handle=?')) return db.members.has(args[0])?{handle:args[0]}:null;
      if (S.startsWith('SELECT COUNT(*) AS n FROM members')) return { n: db.members.size };
      throw new Error('first? '+S);
    },
    async all(){
      if (S.startsWith('SELECT * FROM posts WHERE id <')) return {results: db.posts.filter(p=>p.id<args[0]).sort((a,b)=>b.id-a.id).slice(0,args[1])};
      if (S.startsWith('SELECT * FROM posts ORDER')) return {results: [...db.posts].sort((a,b)=>b.id-a.id).slice(0,args[0])};
      if (S.startsWith('SELECT * FROM replies WHERE post_id IN')) return {results: db.replies.filter(r=>args.includes(r.post_id)).sort((a,b)=>a.id-b.id)};
      if (S.startsWith('SELECT * FROM terms')) return {results: [...db.terms].sort((a,b)=>b.id-a.id)};
      if (S.startsWith('SELECT * FROM visits')) return {results: [...db.visits.values()].sort((a,b)=>b.last_seen-a.last_seen)};
      if (S.startsWith('SELECT handle, is_founder, created_at FROM members')) return {results: [...db.members.values()].map(m=>({handle:m.handle,is_founder:m.is_founder,created_at:m.created_at})).sort((a,b)=>(b.is_founder-a.is_founder)||a.handle.localeCompare(b.handle))};
      throw new Error('all? '+S);
    },
    async run(){
      if (S.startsWith('INSERT INTO config')) { db.config={id:1,gen:1,salt:args[0],fort_hash:args[1],founder_hash:args[2],fort_name:'TREEFORT',dog_name:'DALE'}; return {meta:{}}; }
      if (S.startsWith('INSERT INTO knock_fails')) { db.fails.set(args[0], db.fails.has(args[0])?{ip:args[0],fails:1,window_start:args[2]}:{ip:args[0],fails:1,window_start:args[1]}); return {meta:{}}; }
      if (S.startsWith('UPDATE knock_fails SET fails=fails+1')) { const f=db.fails.get(args[0]); if(f)f.fails++; return {meta:{}}; }
      if (S.startsWith('DELETE FROM knock_fails')) { db.fails.delete(args[0]); return {meta:{}}; }
      if (S.startsWith('INSERT INTO visits')) { const v=db.visits.get(args[0]); if(v){v.last_seen=args[3];v.knocks++;} else db.visits.set(args[0],{name:args[0],first_seen:args[1],last_seen:args[2],knocks:1}); return {meta:{}}; }
      if (S.startsWith('INSERT INTO members')) { const isF = S.includes('VALUES (?, ?, 1, ?)') ? 1 : 0; db.members.set(args[0], {handle:args[0], code_hash:args[1], is_founder:isF, created_at:args[2]}); return {meta:{}}; }
      if (S.startsWith('UPDATE members SET code_hash=? WHERE handle=?')) { const m=db.members.get(args[1]); if(m)m.code_hash=args[0]; return {meta:{}}; }
      if (S.startsWith('INSERT INTO posts')) { const p={id:++postId,author:args[0],type:args[1],text:args[2],media_key:args[3],created:args[4],deleted:0}; db.posts.push(p); return {meta:{last_row_id:p.id}}; }
      if (S.startsWith('INSERT INTO replies')) { const r={id:++replyId,post_id:args[0],author:args[1],text:args[2],created:args[3]}; db.replies.push(r); return {meta:{last_row_id:r.id}}; }
      if (S.startsWith('UPDATE posts SET deleted=1')) { const p=db.posts.find(p=>p.id===args[0]); if(p){p.deleted=1;p.text=null;p.media_key=null;} return {meta:{}}; }
      if (S.startsWith('INSERT INTO terms')) { const t={id:++termId,term:args[0],def:args[1],example:args[2],author:args[3],status:'',created:args[4],died:null}; db.terms.push(t); return {meta:{last_row_id:t.id}}; }
      if (S.startsWith('UPDATE terms SET status=')) { const t=db.terms.find(t=>t.id===args[2]); if(t){t.status=args[0];t.died=args[1];} return {meta:{}}; }
      if (S.startsWith('UPDATE config SET gen=')) { db.config.gen=args[0]; db.config.fort_hash=args[1]; return {meta:{}}; }
      if (S.startsWith('UPDATE config SET')) { const cols=S.match(/SET (.*) WHERE/)[1].split(', '); cols.forEach((c,i)=>{db.config[c.split('=')[0]]=args[i];}); return {meta:{}}; }
      throw new Error('run? '+S);
    }
  };
}
const r2 = new Map();
const env = {
  SESSION_SECRET: 'test-secret-do-not-tell-the-raccoons',
  SEED_TOKEN: 'seed-me-once',
  DB: { prepare },
  MEDIA: {
    async put(k,buf,opts){ r2.set(k,{buf,ct:opts.httpMetadata.contentType}); },
    async head(k){ return r2.has(k)?{key:k}:null; },
    async get(k){ const o=r2.get(k); return o?{body:o.buf,httpMetadata:{contentType:o.ct}}:null; }
  },
  ASSETS: { fetch: async()=>new Response('static') }
};

let cookies = {};
async function call(path, {method='GET', body, raw, ip='1.1.1.1', who='anon'}={}) {
  const headers = {};
  if (cookies[who]) headers['Cookie'] = cookies[who];
  headers['CF-Connecting-IP'] = ip;
  let reqBody;
  if (raw) reqBody = raw;
  else if (body) { reqBody = JSON.stringify(body); headers['Content-Type']='application/json'; }
  const res = await worker.fetch(new Request('https://treefort.lol'+path, {method, headers, body: reqBody}), env);
  const sc = res.headers.get('Set-Cookie');
  if (sc) cookies[who] = sc.split(';')[0];
  let data = null;
  const ct = res.headers.get('Content-Type')||'';
  if (ct.includes('json')) data = await res.json();
  return {status: res.status, data, res};
}
const assert=(c,m)=>{ if(!c) throw new Error('ASSERT: '+m); };
const png = () => { const b=new Uint8Array(64); b.set([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]); return b.buffer; };

(async()=>{
  let r = await call('/api/state');
  assert(r.status===503, 'pre-setup state should 503, got '+r.status);

  // setup founds config (the salt member codes hash against). the v1 fort/founder codes are vestigial.
  r = await call('/api/setup',{method:'POST',body:{fort_code:'abc',founder_code:'short'}});
  assert(r.status===400,'weak codes rejected');
  r = await call('/api/setup',{method:'POST',body:{fort_code:'TREEFROG',founder_code:'RACCOON-PRIME'}});
  assert(r.data.ok,'setup works');
  r = await call('/api/setup',{method:'POST',body:{fort_code:'X23456',founder_code:'Y234567'}});
  assert(r.status===403,'second founding sealed');
  console.log('setup: OK');

  // seeding (grandfather CONNOR + KUSHMAN). guarded by SEED_TOKEN, one time only.
  r = await call('/api/seed',{method:'POST',body:{token:'wrong',connor_code:'FOUNDER1',kushman_code:'DADCODE1'}});
  assert(r.status===403,'seed rejects wrong token');
  r = await call('/api/seed',{method:'POST',body:{token:'seed-me-once',connor_code:'aaa',kushman_code:'bbb'}});
  assert(r.status===400,'seed rejects short codes');
  r = await call('/api/seed',{method:'POST',body:{token:'seed-me-once',connor_code:'SAMEONE',kushman_code:'sameone'}});
  assert(r.status===400,'seed rejects identical codes');
  r = await call('/api/seed',{method:'POST',body:{token:'seed-me-once',connor_code:'FOUNDER1',kushman_code:'DADCODE1'}});
  assert(r.data.ok,'seed works');
  r = await call('/api/seed',{method:'POST',body:{token:'seed-me-once',connor_code:'AGAIN123',kushman_code:'AGAIN456'}});
  assert(r.status===409,'seed refuses once roster exists');
  console.log('seed: OK');

  // wrong knocks trip the cooldown, even a real code afterward
  for(let i=0;i<5;i++){ r=await call('/api/knock',{method:'POST',body:{code:'WRONG'+i},ip:'6.6.6.6'}); assert(r.status===401,'wrong knock 401'); }
  r=await call('/api/knock',{method:'POST',body:{code:'FOUNDER1'},ip:'6.6.6.6'});
  assert(r.status===423 && r.data.cooldown>0,'cooldown locks even a real knock, got '+r.status);
  console.log('knock cooldown: OK ('+r.data.error+')');

  // the code decides identity. a bogus name in the body is ignored — no impersonation possible.
  r=await call('/api/knock',{method:'POST',body:{code:'dadcode1', name:'CONNOR'},ip:'2.2.2.2',who:'kushman'});
  assert(r.data.ok && r.data.role==='member' && r.data.name==='KUSHMAN','member knock resolves to its own handle, ignoring typed name; got '+JSON.stringify(r.data));
  assert(cookies.kushman,'cookie set');
  r=await call('/api/state',{who:'kushman'});
  assert(r.data.name==='KUSHMAN' && r.data.dog_name==='DALE','state works, dog is DALE');
  console.log('member session + anti-impersonation: OK');

  r=await call('/api/post',{method:'POST',body:{type:'text',text:'first. historic.'},who:'kushman'});
  assert(r.data.ok,'text post');
  r=await call('/api/post',{method:'POST',body:{type:'text',text:'   '},who:'kushman'});
  assert(r.status===400,'empty post rejected');
  r=await call('/api/reply',{method:'POST',body:{post_id:1,text:'W'},who:'kushman'});
  assert(r.data.ok,'reply works');
  r=await call('/api/wall',{who:'kushman'});
  assert(r.data.posts.length===1 && r.data.posts[0].author==='KUSHMAN' && r.data.posts[0].replies[0].text==='W','wall stamps the session handle');
  console.log('wall basics: OK');

  r=await call('/api/delete',{method:'POST',body:{post_id:1},who:'kushman'});
  assert(r.status===403,'member cannot delete');

  // founder knock
  r=await call('/api/knock',{method:'POST',body:{code:'FOUNDER1'},ip:'3.3.3.3',who:'connor'});
  assert(r.data.role==='founder' && r.data.name==='CONNOR','founder knock');
  r=await call('/api/upload',{method:'POST',raw:png(),who:'connor'});
  assert(r.data.ok && r.data.media_key.startsWith('m/'),'png upload');
  const mk=r.data.media_key;
  r=await call('/api/post',{method:'POST',body:{type:'painting',media_key:mk,text:'my masterpiece'},who:'connor'});
  assert(r.data.ok,'painting post');
  console.log('uploads + media: OK');

  r=await call('/api/delete',{method:'POST',body:{post_id:2},who:'connor'});
  assert(r.data.ok,'founder delete');
  r=await call('/api/wall',{who:'kushman'});
  const tomb=r.data.posts.find(p=>p.id===2);
  assert(tomb.deleted===true && !tomb.media_key,'tombstone in wall');
  console.log('tombstone: OK');

  r=await call('/api/dict',{method:'POST',body:{term:'rizz',def:'charisma, allegedly',example:'he has zero rizz'},who:'kushman'});
  assert(r.data.ok,'dict add');
  r=await call('/api/dict/status',{method:'POST',body:{id:1,status:'CERTIFIED'},who:'kushman'});
  assert(r.status===403,'member cannot chip');
  r=await call('/api/dict/status',{method:'POST',body:{id:1,status:'DECEASED'},who:'connor'});
  assert(r.data.ok,'founder chips');
  console.log('dictionary: OK');

  r=await call('/api/config',{method:'POST',body:{fort_name:'megafort',dog_name:'beans'},who:'connor'});
  assert(r.data.ok,'config rename');
  r=await call('/api/state',{who:'connor'});
  assert(r.data.fort_name==='MEGAFORT' && r.data.dog_name==='BEANS','rename visible');
  console.log('founder panel: OK');

  // self-service: change my own knock
  r=await call('/api/mycode',{method:'POST',body:{current_code:'WRONGCUR',new_code:'NEWDAD01'},who:'kushman'});
  assert(r.status===400,'wrong current knock rejected');
  r=await call('/api/mycode',{method:'POST',body:{current_code:'DADCODE1',new_code:'NEWDAD01'},who:'kushman'});
  assert(r.data.ok,'own knock changed');
  r=await call('/api/knock',{method:'POST',body:{code:'DADCODE1'},ip:'2.2.2.9',who:'ghost'});
  assert(r.status===401,'old knock is dead');
  r=await call('/api/knock',{method:'POST',body:{code:'NEWDAD01'},ip:'2.2.2.8',who:'kushman2'});
  assert(r.data.ok && r.data.name==='KUSHMAN','new knock lives, same handle');
  console.log('change my knock: OK');

  // founder: add a member
  r=await call('/api/members/add',{method:'POST',body:{handle:'jamie',code:'JAMIE001'},who:'kushman'});
  assert(r.status===403,'member cannot add members');
  r=await call('/api/members/add',{method:'POST',body:{handle:'JAMIE',code:'JAMIE001'},who:'connor'});
  assert(r.data.ok,'founder adds member');
  r=await call('/api/members/add',{method:'POST',body:{handle:'JAMIE',code:'OTHER001'},who:'connor'});
  assert(r.status===400,'duplicate handle rejected');
  r=await call('/api/members/add',{method:'POST',body:{handle:'DALE',code:'JAMIE001'},who:'connor'});
  assert(r.status===400,'duplicate code rejected');
  r=await call('/api/knock',{method:'POST',body:{code:'JAMIE001'},ip:'4.4.4.4',who:'jamie'});
  assert(r.data.ok && r.data.role==='member' && r.data.name==='JAMIE','new member can knock in');
  console.log('add member: OK');

  // founder: reset a member's knock (recovery)
  r=await call('/api/members/reset',{method:'POST',body:{handle:'JAMIE',code:'JAMIE999'},who:'kushman2'});
  assert(r.status===403,'member cannot reset');
  r=await call('/api/members/reset',{method:'POST',body:{handle:'NOBODY',code:'JAMIE999'},who:'connor'});
  assert(r.status===404,'reset unknown handle 404');
  r=await call('/api/members/reset',{method:'POST',body:{handle:'JAMIE',code:'JAMIE999'},who:'connor'});
  assert(r.data.ok,'founder resets a knock');
  r=await call('/api/knock',{method:'POST',body:{code:'JAMIE001'},ip:'4.4.4.5',who:'x'});
  assert(r.status===401,'reset killed the old knock');
  r=await call('/api/knock',{method:'POST',body:{code:'JAMIE999'},ip:'4.4.4.6',who:'jamie2'});
  assert(r.data.ok && r.data.name==='JAMIE','new knock works after reset');
  console.log('reset knock: OK');

  // members list (founder) + knock log (roster)
  r=await call('/api/members',{who:'kushman2'});
  assert(r.status===403,'member cannot list members');
  r=await call('/api/members',{who:'connor'});
  assert(r.data.ok && r.data.members.length===3 && r.data.members[0].handle==='CONNOR' && r.data.members[0].is_founder===1,'members list, founder first');
  assert(!('code_hash' in r.data.members[0]),'members list never leaks a hash');
  r=await call('/api/roster',{who:'connor'});
  assert(r.data.roster.some(v=>v.name==='KUSHMAN'),'knock log works');
  console.log('roster: OK');

  let hit429=false;
  for(let i=0;i<12;i++){ r=await call('/api/post',{method:'POST',body:{type:'text',text:'spam '+i},who:'connor'}); if(r.status===429){hit429=true;break;} }
  assert(hit429,'post rate limit engages');
  console.log('rate limit: OK');

  // logout clears the cookie; the session is gone on the very next request
  r=await call('/api/knock',{method:'POST',body:{code:'FOUNDER1'},ip:'7.7.7.7',who:'leaver'});
  assert(r.data.ok,'leaver knock');
  r=await call('/api/state',{who:'leaver'}); assert(r.status===200 && r.data.ok,'leaver has a live session');
  r=await call('/api/logout',{method:'POST',who:'leaver'}); assert(r.data.ok,'logout ok');
  r=await call('/api/state',{who:'leaver'}); assert(r.status===401,'after logout the session is gone, got '+r.status);
  console.log('logout: OK');

  console.log('\nTHE DOOR WORKS. PER-PERSON KNOCKS, NO IMPERSONATION. ALL ASSERTIONS PASSED.');
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
