import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(os.tmpdir(),'tennis-design-'));
process.env.DATA_DIR=dir;
// Import app rather than its entrypoint: no scheduler or real Telegram sends.
process.env.TELEGRAM_BOT_TOKEN='';process.env.SEOUL_OPEN_API_KEY='';
const {app}=await import('../src/server.js');
const storage=await import('../src/storage.js');
const {beginDelivery,finishDelivery}=await import('../src/deliveryHistory.js');
await storage.addInviteCode({code:'VISUAL-LOCAL'});
const account=await storage.claimInviteCode({code:'VISUAL-LOCAL',name:'화면 검증'});
const link=await storage.createTelegramLinkToken(account.user.id);await storage.connectTelegramLinkToken(link,'fake-local-only');
await storage.addWatch({userId:account.user.id,venues:['gangil','myeongil'],date:'2099-10-17',times:['18:00~20:00']});
await storage.addWatch({userId:account.user.id,venues:['myeonmok'],date:'2099-10-18',times:['08:00~09:50']});
await storage.updateState(state=>{
 const watch=state.watches[0];const group={watch,notifications:[{watch,key:'visual-only',item:{venue:'gangil',venueName:'강일테니스장',date:'2099-10-17',time:'18:00~20:00'}}]};
 const id=beginDelivery(state,group,'🎾 테니스 잡아줘\n강일테니스장 빈자리 발견!\n2099-10-17 18:00~20:00\n발송 당시의 메시지 기록');finishDelivery(state,id,'sent',{result:{message_id:1}});
 const failed=beginDelivery(state,{...group,notifications:[{...group.notifications[0],key:'visual-failure'}]},'실패한 발송 내용');finishDelivery(state,failed,'failed');
});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({headless:true});
 await mkdir('artifacts/design-b',{recursive:true});
 const ref=await browser.newPage({viewport:{width:1440,height:1000}});
 await ref.goto(pathToFileURL(path.resolve('tennis-ui-concepts (1).html')).href);
 await ref.locator('iframe').contentFrame().locator('.history-summary').waitFor();
 await ref.locator('iframe').screenshot({path:'artifacts/design-b/reference-results-mobile.png'});
 await ref.locator('#page').selectOption('home');
 await ref.locator('iframe').contentFrame().locator('.hero').waitFor();
 await ref.locator('iframe').screenshot({path:'artifacts/design-b/reference-home-mobile.png'});
 await ref.locator('#desktop').click();await ref.screenshot({path:'artifacts/design-b/reference-desktop.png',fullPage:false});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addCookies([{name:'tennis_session',value:account.token,url:base}]);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 // Avoid fetching a real external catalog during isolated visual checks.
 await page.route('**/api/seoul/tennis-services*',route=>route.fulfill({json:{places:[],areas:[],placeCount:0,serviceCount:0}}));
 await page.goto(base);await page.screenshot({path:'artifacts/design-b/debug.png',fullPage:true});await page.locator('#heroCount').filter({hasText:'2개'}).waitFor();
 for(const width of [360,390,430,1440]){
  await page.setViewportSize({width,height:width===1440?1000:844});
  const nav=width===1440?'.side':'.bottom';
  await page.locator(`${nav} [data-go=home]`).click();
  assert.equal(await page.locator('[data-screen=home]').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow home ${width}`);
  if(width<760){assert.deepEqual(await page.locator('.bottom button span').allTextContents(),['내 알림','조회 결과','새 알림','조회 현황','설정']);}
  await page.screenshot({path:`artifacts/design-b/home-${width}.png`,fullPage:true});
  await page.locator(`${nav} [data-go=results]`).click();await page.locator('.history-item').first().waitFor();
  assert.equal(await page.locator('#deliveryTotal').textContent(),'1');
  await page.locator('.history-item').first().click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow results ${width}`);
  await page.screenshot({path:`artifacts/design-b/results-${width}.png`,fullPage:true});
  await page.locator('#deliveryFilter').selectOption('failed');await page.locator('#deliveryCount').filter({hasText:'1건'}).waitFor();
  await page.locator('#deliveryFilter').selectOption('all');
  await page.locator(`${nav} [data-go=new]`).click();await page.locator('input[name=venues][value=gangil]').check();
  await page.locator('#nextFormStep').click();await page.locator('input[name=date]').fill('2099-10-19');await page.locator('input[name=anyTime]').check();
  const submit=page.locator('#watchForm button[type=submit]');await submit.scrollIntoViewIfNeeded();
  if(width<760){const rect=await submit.boundingBox();const bottom=await page.locator('.bottom').boundingBox();assert(rect.y+rect.height<=bottom.y,`submit covered ${width}`);}
  await page.screenshot({path:`artifacts/design-b/new-${width}.png`,fullPage:true});
  await page.locator(`${nav} [data-go=status]`).click();await page.screenshot({path:`artifacts/design-b/status-${width}.png`,fullPage:true});
  await page.locator(`${nav} [data-go=settings]`).click();await page.screenshot({path:`artifacts/design-b/settings-${width}.png`,fullPage:true});
  await page.locator(`${nav} [data-go=new]`).click();await page.locator('input[name=venues][value=gangil]').uncheck();
 }
 assert.deepEqual(errors,[]);
 // Exercise actual registration / pause / resume / deletion, with external sending disabled.
 await page.setViewportSize({width:390,height:844});
 await page.locator('.bottom [data-go=new]').click();
 await page.locator('input[name=venues][value=gangil]').check();
 await page.locator('#nextFormStep').click();await page.locator('input[name=date]').fill('2099-10-19');await page.locator('input[name=anyTime]').check();
 await page.locator('#watchForm button[type=submit]').click();await page.locator('[data-screen=home]').waitFor();
 let state=await storage.loadState();const added=state.watches.find(w=>w.date==='2099-10-19');assert(added?.anyTime);assert.equal(added.times.length,8);
 const card=page.locator(`.watch:has(button[data-toggle="${added.id}"])`);await card.locator('summary').click();
 await card.locator('[data-toggle]').click();await page.locator('[data-watch-filter=paused]').filter({hasText:'1'}).waitFor();assert.equal((await storage.loadState()).watches.find(w=>w.id===added.id).enabled,false);
 await card.locator('summary').click();await card.locator('[data-toggle]').click();await page.locator('[data-watch-filter=paused]').filter({hasText:'0'}).waitFor();assert.equal((await storage.loadState()).watches.find(w=>w.id===added.id).enabled,true);
 await card.locator('summary').click();page.once('dialog',dialog=>dialog.accept());await card.locator('[data-delete]').click();await page.locator('[data-watch-filter=all]').filter({hasText:'2'}).waitFor();assert.equal((await storage.loadState()).watches.some(w=>w.id===added.id),false);
 // Long historic content is text, cannot inject markup, and stays inside the viewport.
 await storage.updateState(state=>{state.deliveries[0].items[0].venueName='아주 긴 테니스장 시설 이름 '.repeat(15);state.deliveries[0].message='<img src=x onerror=alert(1)>'+ '긴 발송 내용'.repeat(500);});
 await page.locator('.bottom [data-go=results]').click();await page.locator('.history-item').filter({hasText:'아주 긴'}).waitFor();await page.locator('.history-item').filter({hasText:'아주 긴'}).locator('summary').click();assert.equal(await page.locator('.message-body img').count(),0);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/design-b/long-history-390.png',fullPage:false});
 // Failure and loading states are UI-only fault injection; history itself used the real authenticated API.
 await page.route('**/api/deliveries?**',async route=>{await new Promise(r=>setTimeout(r,150));await route.fulfill({status:503,json:{error:'unavailable'}});});
 await page.locator('.bottom [data-go=results]').click();await page.locator('#deliveryRows').filter({hasText:'불러오는 중'}).waitFor();await page.locator('#deliveryRetry').waitFor();assert.match(await page.locator('#todayDeliveryCopy').textContent(),/확인하지 못/);await page.unroute('**/api/deliveries?**');
 await storage.updateState(state=>{state.watches=[];state.deliveries=[];const u=state.users.find(u=>u.id===account.user.id);u.telegramConnected=false;u.telegramChatId=null;});
 await page.reload();await page.locator('.empty h2').waitFor();await page.screenshot({path:'artifacts/design-b/empty-390.png',fullPage:true});
 await page.locator('.bottom [data-go=results]').click();await page.locator('.history-empty').filter({hasText:'내역이 없습니다'}).waitFor();
 await page.locator('.bottom [data-go=new]').click();assert.equal(await page.locator('#newConnectionNotice').isVisible(),true);assert.equal(await page.locator('#watchForm button[type=submit]').isDisabled(),true);
 await page.locator('.bottom [data-go=settings]').click();assert.equal(await page.locator('#telegramPanel').isVisible(),true);await page.screenshot({path:'artifacts/design-b/disconnected-390.png',fullPage:true});
 await context.clearCookies();await page.reload();await page.locator('#invitePanel').waitFor();await page.locator('#showDeviceLink').click();assert.equal(await page.locator('#deviceLinkClaimForm').isVisible(),true);await page.screenshot({path:'artifacts/design-b/entry-390.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('Actual API registration, pause, resume, deletion; long content, loading/failure/empty, disconnected and account-link screens passed.');
 console.log('Reference rendered; mobile 360/390/430 and desktop 1440: navigation, filters, overflow, submit clearance passed.');
 console.log('Screenshots: artifacts/design-b');
}finally{await browser?.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
