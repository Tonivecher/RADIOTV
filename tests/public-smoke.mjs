import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from '../evidence/browser-tools/node_modules/playwright/index.mjs';
const origin='https://radio.tonivecher.online';
const checks=[];
const health=await(await fetch(origin+'/api/health')).json();assert.equal(health.ok,true);assert.equal(health.setsCount,221);checks.push('public-health');
for(const file of ['/src/App.tsx','/package.json','/server/radiotv.sqlite','/server/.secret','/.env']){
 const r=await fetch(origin+file,{method:'HEAD'});assert.equal(r.status,404,file);
}
checks.push('private-static-paths-blocked');
const state=await(await fetch(origin+'/api/radio/state')).json();assert.equal(state.demoMode,false);assert.equal(state.audienceMetric,'connections');assert(state.channels.every(c=>c.setId));
const archive=await(await fetch(origin+'/api/radio/archive')).json();assert.equal(archive.total,221);checks.push('all-sets-available');
for(const ch of state.channels){
 const url=origin+'/api/radio/stream-set/'+ch.setId;
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert(head.headers.get('etag'));assert(head.headers.get('content-disposition').includes('radiotv-live'));
 const range=await fetch(url,{headers:{Range:'bytes=0-1023'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);
 const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-show_chapters','-of','json',url],{encoding:'utf8',timeout:60000}));
 assert.equal(probe.streams.length,1);assert.equal(probe.streams[0].codec_type,'audio');assert.equal(probe.chapters?.length||0,0);
 const allowed=new Set(['major_brand','minor_version','compatible_brands','encoder','language','handler_name','vendor_id']);
 for(const tags of [probe.format?.tags,...probe.streams.map(s=>s.tags)])for(const key of Object.keys(tags||{}))assert(allowed.has(key.toLowerCase()),key);
}
checks.push('three-public-streams-range-and-metadata');
const challenge=await(await fetch(origin+'/api/auth/challenge')).json();let nonce=0;
while(!crypto.createHash('sha256').update(challenge.prefix+nonce).digest('hex').startsWith('0'.repeat(challenge.difficulty)))nonce++;
const bad=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callsign:'smoke_no_create',pin:'0000',challengeId:challenge.challengeId,nonce})});
assert.equal(bad.status,400);assert((await bad.json()).error.includes('PIN'));checks.push('default-pin-rejected-without-writing-user');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/?skipBoot=1');await page.locator('.chat-online-pill').waitFor();
 assert((await page.locator('.chat-online-pill').innerText()).includes('ПОДКЛЮЧЕНО'));
 const scripts=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('src')));
 const html=fs.readFileSync('dist/index.html','utf8');assert(scripts.some(src=>html.includes(src)));
 await page.evaluate(async()=>{await document.querySelector('audio').play();});
 await page.waitForFunction(()=>{const a=document.querySelector('audio');return !a.paused&&a.currentTime>0&&!a.error;});
 await page.locator('.channel-lens-row').nth(1).click();
 await page.waitForFunction(()=>{const a=document.querySelector('audio');return a.currentSrc.includes('ch-deep')&&a.readyState>=2&&!a.error;});
 await page.screenshot({path:'evidence/production-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'evidence/production-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);checks.push('public-browser-playback-channel-switch-and-new-bundle');
}finally{await browser.close();}
fs.writeFileSync('evidence/public-smoke.json',JSON.stringify({ok:true,checks,errors,completedAt:new Date().toISOString()},null,2));console.log(JSON.stringify({ok:true,checks,errors}));
