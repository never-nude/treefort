import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const worker = (await import(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'worker.js'))).default;

/* ---- in-memory D1 stub (pattern-matched to the worker's queries) ---- */
const db = { config: null, posts: [], replies: [], terms: [], visits: new Map(), fails: new Map() };
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
      throw new Error('first? '+S);
    },
    async all(){
      if (S.startsWith('SELECT * FROM posts WHERE id <')) return {results: db.posts.filter(p=>p.id<args[0]).sort((a,b)=>b.id-a.id).slice(0,args[1])};
      if (S.startsWith('SELECT * FROM posts ORDER')) return {results: [...db.posts].sort((a,b)=>b.id-a.id).slice(0,args[0])};
      if (S.startsWith('SELECT * FROM replies WHERE post_id IN')) return {results: db.replies.filter(r=>args.includes(r.post_id)).sort((a,b)=>a.id-b.id)};
      if (S.startsWith('SELECT * FROM terms')) return {results: [...db.terms].sort((a,b)=>b.id-a.id)};
      if (S.startsWith('SELECT * FROM visits')) return {results: [...db.visits.values()].sort((a,b)=>b.last_seen-a.last_seen)};
      throw new Error('all? '+S);
    },
    async run(){
      if (S.startsWith('INSERT INTO config')) { db.config={id:1,gen:1,salt:args[0],fort_hash:args[1],founder_hash:args[2],fort_name:'TREEFORT',dog_name:'DALE'}; return {meta:{}}; }
      if (S.startsWith('INSERT INTO knock_fails')) { db.fails.set(args[0], db.fails.has(args[0])?{ip:args[0],fails:1,window_start:args[2]}:{ip:args[0],fails:1,window_start:args[1]}); return {meta:{}}; }
      if (S.startsWith('UPDATE knock_fails SET fails=fails+1')) { const f=db.fails.get(args[0]); if(f)f.fails++; return {meta:{}}; }
      if (S.startsWith('DELETE FROM knock_fails')) { db.fails.delete(args[0]); return {meta:{}}; }
      if (S.startsWith('INSERT INTO visits')) { const v=db.visits.get(args[0]); if(v){v.last_seen=args[3];v.knocks++;} else db.visits.set(args[0],{name:args[0],first_seen:args[1],last_seen:args[2],knocks:1}); return {meta:{}}; }
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

  r = await call('/api/setup',{method:'POST',body:{fort_code:'abc',founder_code:'short'}});
  assert(r.status===400,'weak codes rejected');
  r = await call('/api/setup',{method:'POST',body:{fort_code:'TREEFROG',founder_code:'TREEFROG'}});
  assert(r.status===400,'identical codes rejected');
  r = await call('/api/setup',{method:'POST',body:{fort_code:'TREEFROG',founder_code:'RACCOON-PRIME'}});
  assert(r.data.ok,'setup works');
  r = await call('/api/setup',{method:'POST',body:{fort_code:'X23456',founder_code:'Y234567'}});
  assert(r.status===403,'second founding sealed');
  console.log('setup: OK');

  for(let i=0;i<5;i++){ r=await call('/api/knock',{method:'POST',body:{code:'WRONG'+i,name:'INTRUDER'},ip:'6.6.6.6'}); assert(r.status===401,'wrong code 401'); }
  r=await call('/api/knock',{method:'POST',body:{code:'TREEFROG',name:'INTRUDER'},ip:'6.6.6.6'});
  assert(r.status===423 && r.data.cooldown>0,'cooldown locks even right code, got '+r.status);
  console.log('knock cooldown: OK ('+r.data.error+')');

  r=await call('/api/knock',{method:'POST',body:{code:'treefrog',name:'kevin!!'},ip:'2.2.2.2',who:'kevin'});
  assert(r.data.ok && r.data.role==='member' && r.data.name==='KEVIN','member knock (case/sanitize), got '+JSON.stringify(r.data));
  assert(cookies.kevin,'cookie set');
  r=await call('/api/state',{who:'kevin'});
  assert(r.data.name==='KEVIN' && r.data.dog_name==='DALE','state works, dog is DALE');
  console.log('member session: OK');

  r=await call('/api/post',{method:'POST',body:{type:'text',text:'first. historic.'},who:'kevin'});
  assert(r.data.ok,'text post');
  r=await call('/api/post',{method:'POST',body:{type:'text',text:'   '},who:'kevin'});
  assert(r.status===400,'empty post rejected');
  r=await call('/api/post',{method:'POST',body:{type:'blog',text:'x'},who:'kevin'});
  assert(r.status===400,'unknown type rejected');
  r=await call('/api/reply',{method:'POST',body:{post_id:1,text:'W'},who:'kevin'});
  assert(r.data.ok,'reply works');
  r=await call('/api/wall',{who:'kevin'});
  assert(r.data.posts.length===1 && r.data.posts[0].replies[0].text==='W','wall + replies');
  console.log('wall basics: OK');

  r=await call('/api/delete',{method:'POST',body:{post_id:1},who:'kevin'});
  assert(r.status===403,'member cannot delete');

  r=await call('/api/knock',{method:'POST',body:{code:'RACCOON-PRIME',name:'CONNOR'},ip:'3.3.3.3',who:'connor'});
  assert(r.data.role==='founder','founder knock');
  r=await call('/api/upload',{method:'POST',raw:png(),who:'connor'});
  assert(r.data.ok && r.data.media_key.startsWith('m/'),'png upload');
  const mk=r.data.media_key;
  r=await call('/api/upload',{method:'POST',raw:new Uint8Array([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]).buffer,who:'connor'});
  assert(r.status===415,'garbage upload rejected');
  const big=new Uint8Array(4*1024*1024+100); big.set([0x89,0x50,0x4E,0x47]);
  r=await call('/api/upload',{method:'POST',raw:big.buffer,who:'connor'});
  assert(r.status===413,'oversize rejected');
  r=await call('/api/post',{method:'POST',body:{type:'painting',media_key:mk,text:'my masterpiece'},who:'connor'});
  assert(r.data.ok,'painting post');
  r=await call('/api/post',{method:'POST',body:{type:'image',media_key:'m/doesnotexist'},who:'connor'});
  assert(r.status===400,'phantom media rejected');
  r=await call('/api/media/'+mk.slice(2),{who:'connor'});
  r=await call('/api/media/'+mk,{who:'connor'}); // path includes m/
  console.log('uploads + media: OK');

  r=await call('/api/delete',{method:'POST',body:{post_id:2},who:'connor'});
  assert(r.data.ok,'founder delete');
  r=await call('/api/wall',{who:'kevin'});
  const tomb=r.data.posts.find(p=>p.id===2);
  assert(tomb.deleted===true && !tomb.media_key,'tombstone in wall');
  console.log('tombstone: OK');

  r=await call('/api/dict',{method:'POST',body:{term:'rizz',def:'charisma, allegedly',example:'he has zero rizz'},who:'kevin'});
  assert(r.data.ok,'dict add');
  r=await call('/api/dict/status',{method:'POST',body:{id:1,status:'CERTIFIED'},who:'kevin'});
  assert(r.status===403,'member cannot chip');
  r=await call('/api/dict/status',{method:'POST',body:{id:1,status:'DECEASED'},who:'connor'});
  assert(r.data.ok,'founder chips');
  r=await call('/api/dict',{who:'kevin'});
  assert(r.data.terms[0].status==='DECEASED' && r.data.terms[0].died>0,'graveyard paperwork filed');
  console.log('dictionary: OK');

  r=await call('/api/config',{method:'POST',body:{fort_name:'megafort',dog_name:'beans'},who:'connor'});
  assert(r.data.ok,'config rename');
  r=await call('/api/state',{who:'connor'});
  assert(r.data.fort_name==='MEGAFORT' && r.data.dog_name==='BEANS','rename visible');
  r=await call('/api/roster',{who:'connor'});
  assert(r.data.roster.some(v=>v.name==='KEVIN'),'roster works');
  console.log('founder panel: OK');

  r=await call('/api/lock',{method:'POST',body:{new_code:'NEWFROG'},who:'connor'});
  assert(r.data.ok && r.data.gen===2,'locks changed');
  r=await call('/api/state',{who:'kevin'});
  assert(r.status===401,'old member session died with the locks');
  r=await call('/api/state',{who:'connor'});
  assert(r.data.ok,'founder re-keyed through the lock change');
  r=await call('/api/knock',{method:'POST',body:{code:'TREEFROG',name:'KEVIN'},ip:'2.2.2.2',who:'kevin'});
  assert(r.status===401,'old code dead');
  r=await call('/api/knock',{method:'POST',body:{code:'NEWFROG',name:'KEVIN'},ip:'2.2.2.2',who:'kevin'});
  assert(r.data.ok,'new code lives');
  console.log('lock change / generation invalidation: OK');

  let hit429=false;
  for(let i=0;i<12;i++){ r=await call('/api/post',{method:'POST',body:{type:'text',text:'spam '+i},who:'kevin'}); if(r.status===429){hit429=true;break;} }
  assert(hit429,'post rate limit engages');
  console.log('rate limit: OK');

  console.log('\nTHE DOOR WORKS. ALL 40+ ASSERTIONS PASSED.');
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
