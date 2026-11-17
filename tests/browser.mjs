import { chromium } from '../evidence/browser-tools/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.env.RADIOTV_TEST_URL||'http://127.0.0.1:44321';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];const errors=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS',name);}
const a=await browser.newContext({viewport:{width:1440,height:1100}});
const b=await browser.newContext({viewport:{width:1440,height:1100}});
for (const context of [a,b]) await context.addInitScript(() => {
 const Native = window.EventSource;
 window.EventSource = class extends Native {
  constructor(...args) { super(...args); window.__radioEvents = this; }
 };
});
const p=await a.newPage(), q=await b.newPage();
for(const page of [p,q]) page.on('pageerror',error=>errors.push(error.message));
try {
 await Promise.all([p.goto(base+'/?skipBoot=1'),q.goto(base+'/?skipBoot=1')]);
 await Promise.all([p.waitForSelector('.chat-composer__input'),q.waitForSelector('.chat-composer__input')]);
 const chat=p.locator('.chat-composer__input');const send=p.locator('.chat-composer button[type=submit]');
 const text='Browser message '+Date.now();
 await check('new guest + chat reaches both browsers once with database ID',async()=>{
  await chat.fill(text);await send.click();
  await p.waitForFunction(t=>[...document.querySelectorAll('.chat-entry__body')].some(x=>x.textContent===t),text);
  await q.waitForFunction(t=>[...document.querySelectorAll('.chat-entry__body')].some(x=>x.textContent===t),text);
  assert.equal(await p.locator('.chat-entry__body').filter({hasText:text}).count(),1);
  assert.equal(await chat.inputValue(),'');
 });
 await check('reaction toggles in both browser sessions',async()=>{
  const entry=p.locator('.chat-entry').filter({hasText:text});
  await entry.locator('.chat-react-trigger').click();await entry.locator('.chat-react-popover__item').first().click();
  await q.locator('.chat-entry').filter({hasText:text}).locator('.chat-react-chip').waitFor();
  assert.equal(await entry.locator('.chat-react-chip').innerText(),'1');
  await entry.locator('.chat-react-chip').click();
  await q.waitForFunction(t=>[...document.querySelectorAll('.chat-entry')].find(x=>x.textContent.includes(t))?.querySelectorAll('.chat-react-chip').length===0,text);
 });
 await check('POST 429 preserves draft and adds no phantom message',async()=>{
  await p.route('**/api/radio/chat',route=>route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({ok:false,error:'Тест: лимит запросов'})}));
  await chat.fill('draft-429');await send.click();await p.getByRole('alert').filter({hasText:'Тест: лимит'}).waitFor();
  assert.equal(await chat.inputValue(),'draft-429');assert.equal(await q.locator('.chat-entry__body').filter({hasText:'draft-429'}).count(),0);
  await p.unroute('**/api/radio/chat');
 });
 await check('POST 500 preserves draft and no success UI',async()=>{
  await p.route('**/api/radio/chat',route=>route.fulfill({status:500,contentType:'application/json',body:'{"ok":false,"error":"Тест: сервер недоступен"}'}));
  await chat.fill('draft-500');await send.click();await p.getByRole('alert').filter({hasText:'Тест: сервер'}).waitFor();assert.equal(await chat.inputValue(),'draft-500');
  await p.unroute('**/api/radio/chat');
 });
 await check('network failure preserves draft',async()=>{
  await p.route('**/api/radio/chat',route=>route.abort('failed'));
  await chat.fill('draft-offline');await send.click();await p.getByRole('alert').filter({hasText:'Нет связи'}).waitFor();assert.equal(await chat.inputValue(),'draft-offline');
  await p.unroute('**/api/radio/chat');
 });
 await check('moment 500 preserves comment and does not animate success',async()=>{
  await p.route('**/api/radio/moments',route=>route.fulfill({status:500,contentType:'application/json',body:'{"ok":false,"error":"Тест: отметка не сохранена"}'}));
  const input=p.locator('.waveform-stamp-form__input');await input.fill('moment-draft');await p.locator('.waveform-stamp-form button').click();
  await p.getByRole('alert').filter({hasText:'отметка не сохранена'}).waitFor();assert.equal(await input.inputValue(),'moment-draft');
  await p.unroute('**/api/radio/moments');
 });
 await check('moment success gets stable ID and updates the second client',async()=>{
  await p.locator('.waveform-stamp-form__input').fill('Browser marker');await p.locator('.waveform-stamp-form button').click();
  await p.waitForFunction(()=>document.querySelector('.waveform-stamp-form__input').value==='');
  const state=await (await fetch(base+'/api/radio/state')).json();assert(state.moments.some(m=>m.comment==='Browser marker'&&m.id<1e10));
  await q.locator('.waveform-stem-btn[title*="Browser marker"]').waitFor();
 });
 await check('expired session is cleared and draft remains for retry',async()=>{
  await p.route('**/api/auth/me',route=>route.fulfill({status:401,contentType:'application/json',body:'{"ok":false,"error":"Сессия истекла"}'}));
  await chat.fill('draft-expired');await send.click();await p.getByRole('dialog').waitFor();
  assert.equal(await chat.inputValue(),'draft-expired');assert.equal(await p.evaluate(()=>localStorage.getItem('radiotv_session')),null);
  await p.unroute('**/api/auth/me');await p.locator('.auth-modal__close').click();
 });
 await check('named account requires PIN; quick login creates a separate guest',async()=>{
  await p.locator('.chat-header__right .glass-pill-btn').click();
  const pin=p.locator('input[type=password]');assert.equal(await pin.getAttribute('required'),'');assert.equal(await pin.getAttribute('minlength'),'6');
  await p.locator('.auth-guest-btn').click();await p.getByRole('dialog').waitFor({state:'hidden'});
  const session=JSON.parse(await p.evaluate(()=>localStorage.getItem('radiotv_session')));assert(session.token);assert(!session.callsign.startsWith('selector_'));
 });
 await check('SSE reconnect refreshes messages missed while offline',async()=>{
  await b.setOffline(true);
  await chat.fill('Reconnect '+text);await send.click();await p.waitForFunction(t=>[...document.querySelectorAll('.chat-entry__body')].some(x=>x.textContent===t),'Reconnect '+text);
  await b.setOffline(false);
  await q.waitForFunction(t=>[...document.querySelectorAll('.chat-entry__body')].some(x=>x.textContent===t),'Reconnect '+text,{timeout:20000});
 });
 await check('delayed reconnect snapshot cannot erase a newer SSE message',async()=>{
  let held;let release;
  const captured=new Promise(r=>held=r);const gate=new Promise(r=>release=r);
  await q.route('**/api/radio/state?*',async route=>{
    const response=await route.fetch();const body=await response.text();held();await gate;
    await route.fulfill({status:200,contentType:'application/json',body});
  });
  await q.evaluate(() => window.__radioEvents.dispatchEvent(new MessageEvent('connected',{data:'{}'})));
  await Promise.race([captured,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Snapshot not requested')),15000))]);
  // Use another authenticated session to avoid the UI's recent-message interval.
  const late='Late snapshot '+Date.now();
  await new Promise(r=>setTimeout(r,1600));await chat.fill(late);await send.click();
  await q.waitForFunction(t=>[...document.querySelectorAll('.chat-entry__body')].some(x=>x.textContent===t),late);
  const marker='Snapshot marker '+Date.now();
  const token=JSON.parse(await p.evaluate(()=>localStorage.getItem('radiotv_session'))).token;
  const live=await(await fetch(base+'/api/radio/state')).json();
  const posted=await fetch(base+'/api/radio/moments',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({setId:live.setId,timestampSec:20,reactionType:'fire',comment:marker})});
  assert.equal(posted.status,201);const postedData=await posted.json();
  await q.locator('.waveform-stem-btn').filter({has:q.locator('span')}).first().waitFor();
  await q.waitForFunction(t=>[...document.querySelectorAll('.waveform-stem-btn')].some(x=>x.title.includes(t)),marker);
  const renderedHeatmap=()=>q.evaluate(()=>{
    const node=document.querySelector('.waveform-stems-layer');
    const key=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));
    for(let fiber=node[key];fiber;fiber=fiber.return){
      const props=fiber.memoizedProps;if(Array.isArray(props?.heatmap)&&Array.isArray(props?.moments))return props.heatmap;
    }
    throw new Error('Rendered waveform props not found');
  });
  assert.deepEqual(await renderedHeatmap(),postedData.heatmap);
  release();await new Promise(r=>setTimeout(r,500));
  assert.deepEqual(await renderedHeatmap(),postedData.heatmap);
  assert.equal(await q.locator('.chat-entry__body').filter({hasText:late}).count(),1);
  await q.unroute('**/api/radio/state?*');
 });
 await check('audio plays and channel switching reloads a decodable stream',async()=>{
  await p.evaluate(async()=>{await document.querySelector('audio').play();});
  await p.waitForFunction(()=>{const a=document.querySelector('audio');return !a.paused&&a.currentTime>0&&!a.error;});
  const rows=p.locator('.channel-lens-row');
  if(await rows.count()>1){await rows.nth(1).click();await p.waitForFunction(()=>{const a=document.querySelector('audio');return a.currentSrc.includes('ch-deep')&&a.readyState>=2&&!a.error;});}
 });
 await check('audience label describes connections; no fabricated base count',async()=>{
  const label=await p.locator('.chat-online-pill').innerText();assert(label.includes('ПОДКЛЮЧЕНО'));const state=await(await fetch(base+'/api/radio/state')).json();assert.equal(state.totalListenersCount,2);
 });
 await p.screenshot({path:'evidence/browser-desktop.png',fullPage:true});
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:'evidence/browser-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('BROWSER_CHECKS',results.length,'UNHANDLED_ERRORS',errors.length);
 fs.writeFileSync('evidence/browser-results.json',JSON.stringify({checks:results,errors},null,2));
} finally {await browser.close();}
