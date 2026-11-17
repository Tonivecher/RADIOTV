import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = process.env.RADIOTV_TEST_DATA_DIR || path.resolve('test-data');
Object.assign(process.env, { RADIOTV_DATA_DIR: root, RADIOTV_SETS_DIRS: `${root}/sets:${root}/moved`, RADIOTV_AUDIO_CACHE: `${root}/cache`, RADIOTV_SECRET: 'isolated-regression-test-secret-not-production', RADIOTV_DEMO: '0' });
const { getClientIp, checkRateLimit, isStrongPin, signToken, hashPin } = await import('../server/security.mjs');
const { db, scanAndSyncSets, getAvailableSets, getCurrentBroadcast, getMomentsForSet, getRecentChatMessages } = await import('../server/db.mjs');
const { resolvePublicFile } = await import('../server/static.mjs');
const { sanitizedAudioPath } = await import('../server/media.mjs');
const base = process.env.RADIOTV_TEST_URL || 'http://127.0.0.1:44321';
const json = async (url, init) => { const r = await fetch(base + url, init); return { status: r.status, data: await r.json() }; };
async function login(body = {}, endpoint = 'guest') {
 const { data: ch } = await json('/api/auth/challenge');
 let nonce=0;
 while (!crypto.createHash('sha256').update(ch.prefix + nonce).digest('hex').startsWith('0'.repeat(ch.difficulty))) nonce++;
 return json(`/api/auth/${endpoint}`, { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,challengeId:ch.challengeId,nonce}) });
}
const post = (url, body, token) => json(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
let guest, second, message, moment;

test('PIN defaults and weak combinations are rejected',()=>{
 for(const pin of ['', '0000', '9090', '111111', '123456', '654321']) assert.equal(isStrongPin(pin),false);
 assert.equal(isStrongPin('372918'),true);
});
test('untrusted XFF is ignored; configured proxies are traversed from the socket',()=>{
 delete process.env.RADIOTV_TRUSTED_PROXIES;
 assert.equal(getClientIp({socket:{remoteAddress:'::ffff:203.0.113.7'},headers:{'x-forwarded-for':'1.2.3.4'}}),'203.0.113.7');
 process.env.RADIOTV_TRUSTED_PROXIES='127.0.0.1';
 assert.equal(getClientIp({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'1.2.3.4, 203.0.113.9'}}),'203.0.113.9');
 assert.equal(getClientIp({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'garbage'}}),'127.0.0.1');
 delete process.env.RADIOTV_TRUSTED_PROXIES;
});
test('account limiter is independent of changing IP',()=>{
 for(let i=0;i<5;i++) assert.equal(checkRateLimit('loginAccount','same-account').allowed,true);
 assert.equal(checkRateLimit('loginAccount','same-account').allowed,false);
 assert.equal(checkRateLimit('loginAccount','another-account').allowed,true);
});
test('static roots, hidden names, traversal and escaping symlinks',()=>{
 const dir=path.join(root,'static-check');fs.mkdirSync(dir+'/dist',{recursive:true});fs.mkdirSync(dir+'/public',{recursive:true});
 fs.writeFileSync(dir+'/dist/index.html','ok');fs.writeFileSync(dir+'/secret.txt','private');fs.writeFileSync(dir+'/public/.env','private');
 try{fs.symlinkSync('../secret.txt',dir+'/public/escape');}catch{}
 assert.equal(resolvePublicFile(dir,'/'),dir+'/dist/index.html');
 for(const url of ['/secret.txt','/.env','/%2eenv','/../secret.txt','/escape','/src/App.tsx','/package.json']) assert.equal(resolvePublicFile(dir,url),null,url);
});
test('all supported containers lose title/artist; decoded audio and original bytes survive',async()=>{
 const formats=path.join(root,'formats');fs.mkdirSync(formats,{recursive:true});
 for(const ext of ['wav','mp3','m4a','flac','aiff','ogg']){
  const src=path.join(formats,'private-name.'+ext);
  execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=333:duration=1','-metadata','title=RADIOTV_CANARY_TITLE','-metadata','artist=RADIOTV_CANARY_ARTIST','-y',src]);
  const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');const before=hash();
  const clean=await sanitizedAudioPath(src);assert.notEqual(clean,src);assert.equal(hash(),before);
  const info=execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',clean],{encoding:'utf8'});
  assert(!info.includes('RADIOTV_CANARY_'),ext);assert(!fs.readFileSync(clean).includes(Buffer.from('RADIOTV_CANARY_')),ext);
  const audioHash=f=>execFileSync('ffmpeg',['-v','error','-i',f,'-map','0:a:0','-f','hash','-hash','sha256','-'],{encoding:'utf8'}).trim();
  assert.equal(audioHash(clean),audioHash(src),ext);
 }
});
test('new database has no fabricated users, moments, messages or listeners',async()=>{
 const {data}=await json('/api/radio/state');assert.equal(data.demoMode,false);assert.equal(data.listenersCount,0);
 assert.equal(data.messages.length,0);assert.equal(data.moments.length,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
});
test('guest is unique session-only; missing PIN and seeded identities cannot log in',async()=>{
 guest=(await login()).data;second=(await login()).data;
 assert(guest.session.token);assert(guest.user.isGuest);assert.notEqual(guest.user.id,second.user.id);assert.equal(guest.generatedPin,undefined);
 assert.equal((await login({callsign:'no_pin'},'login')).status,400);
 assert.equal((await login({callsign:guest.user.callsign,pin:'372918'},'login')).status,401);
 const pin=hashPin('372918');
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,0,?,?)').run('u-seed-test','seed_test',pin.hash,pin.salt,'#123456',Date.now(),Date.now());
 assert.equal((await login({callsign:'seed_test',pin:'372918'},'login')).status,401);
 const token=signToken({id:'u-seed-test',callsign:'seed_test'});
 assert.equal((await json('/api/auth/me',{headers:{Authorization:`Bearer ${token}`}})).status,401);
 const normal=await login({callsign:'normal_test',pin:'372918'},'login');assert.equal(normal.status,200);
 assert.equal((await login({callsign:'normal_test',pin:'372918'},'login')).data.user.id,normal.data.user.id);
});
test('API stores server IDs; unauthorized writes fail; reactions toggle and likes deduplicate',async()=>{
 const tok=guest.token;const state=(await json('/api/radio/state')).data;
 assert.equal((await post('/api/radio/chat',{text:'unauthorized'},'bad')).status,401);
 let r=await post('/api/radio/chat',{text:'Server integration message'},tok);assert.equal(r.status,201);message=r.data.message;
 assert(message.id>0&&message.id<1e10);
 r=await post('/api/radio/moments',{setId:state.setId,timestampSec:12,reactionType:'heart',comment:'Integration moment'},tok);assert.equal(r.status,201);moment=r.data.moment;
 r=await post(`/api/radio/chat/${message.id}/react`,{reactionType:'heart'},tok);assert.equal(r.data.reactions.heart,1);
 r=await post(`/api/radio/chat/${message.id}/react`,{reactionType:'heart'},tok);assert.equal(r.data.reactions.heart,undefined);
 r=await post(`/api/radio/moments/${moment.id}/react`,{},second.token);const n=r.data.moment.likesCount;
 r=await post(`/api/radio/moments/${moment.id}/react`,{},second.token);assert.equal(r.data.alreadyLiked,true);assert.equal(r.data.moment.likesCount,n);
 assert.equal((await post('/api/radio/moments',{setId:'missing'},tok)).status,404);
});
test('SSE emits one canonical named frame and truthful connection counts',async()=>{
 const ac=new AbortController();const res=await fetch(base+'/api/radio/events?channel=ch-deep',{signal:ac.signal});const reader=res.body.getReader();
 let frames='';const consume=(async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;frames+=new TextDecoder().decode(value);}}catch{}})();
 try{
  await new Promise(r=>setTimeout(r,100));
  assert.equal((await json('/api/radio/state?channel=ch-deep')).data.listenersCount,1);
  assert.equal((await json('/api/radio/state?channel=ch-main')).data.listenersCount,0);
  await post(`/api/radio/chat/${message.id}/react`,{reactionType:'fire'},second.token);
  await new Promise(r=>setTimeout(r,100));
  const social=frames.split('\n\n').filter(x=>x.includes('"type":"chat:reaction"'));assert.equal(social.length,1);assert(social[0].includes('event: chat:reaction'));
 }finally{ac.abort();await consume;}
});
test('stream GET/HEAD/Range serve sanitized bytes; missing original never falls back',async()=>{
 const set=db.prepare('SELECT * FROM sets ORDER BY seq_num LIMIT 1').get();const url=base+'/api/radio/stream-set/'+set.id;
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert(head.headers.get('content-disposition').includes('radiotv-live.wav'));
 assert(head.headers.get('etag'));
 assert.equal((await fetch(url,{method:'HEAD',headers:{Range:'bytes=0-99','If-Range':'"old-audio"'}})).status,200);
 assert.equal((await fetch(url,{method:'HEAD',headers:{Range:'bytes=-'}})).status,416);
 const range=await fetch(url,{headers:{Range:'bytes=0-4095'}});assert.equal(range.status,206);const bytes=Buffer.from(await range.arrayBuffer());assert.equal(bytes.length,4096);assert(!bytes.includes(Buffer.from('RADIOTV_CANARY')));
 assert.equal((await fetch(url,{headers:{Range:'bytes=999999999-'}})).status,416);
 const removed=set.filepath+'.offline';fs.renameSync(set.filepath,removed);
 try{assert.equal((await fetch(url)).status,404);}finally{fs.renameSync(removed,set.filepath);}
});
test('rescan repairs moved paths without changing IDs or social records; missing sets leave rotation',async()=>{
 const rows=getAvailableSets();const set=rows[0];const target=path.join(root,'moved',path.basename(set.filepath));
 const before=db.prepare('SELECT COUNT(*) AS n FROM waveform_moments').get().n;
 fs.renameSync(set.filepath,target);await scanAndSyncSets();assert.equal(db.prepare('SELECT filepath FROM sets WHERE id=?').get(set.id).filepath,target);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sets').get().n,3);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM waveform_moments').get().n,before);
 fs.renameSync(target,target+'.offline');try{assert(!getAvailableSets().some(x=>x.id===set.id));for(const ch of ['ch-main','ch-deep','ch-afterglow']) assert.notEqual(getCurrentBroadcast(ch).setId,set.id);}finally{fs.renameSync(target+'.offline',target);}
});
test('legacy demo rows survive but are hidden from normal API reads',()=>{
 const now=Date.now();const set=getAvailableSets()[0];
 db.prepare('INSERT INTO waveform_moments(set_id,user_id,callsign,avatar_color,timestamp_sec,reaction_type,comment,likes_count,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(set.id,'u-seed-test','seed_test','#123456',1,'fire','demo',90,now);
 db.prepare('INSERT INTO chat_messages(channel_id,user_id,callsign,avatar_color,text,set_id,set_code,set_timestamp_sec,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run('ch-main','u-seed-test','seed_test','#123456','demo',set.id,set.code,1,now);
 assert(!getMomentsForSet(set.id).some(x=>x.userId==='u-seed-test'));assert(!getRecentChatMessages().some(x=>x.userId==='u-seed-test'));
 assert(db.prepare("SELECT COUNT(*) AS n FROM waveform_moments WHERE user_id='u-seed-test'").get().n>0);
});
test('changing forged XFF does not reset HTTP login limit',async()=>{
 let limited=false;
 for(let i=0;i<18;i++){
  const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${i+1}`},body:'{}'});
  if(res.status===429)limited=true;
  if(limited)assert.equal(res.status,429);
 }
 assert(limited);
});
