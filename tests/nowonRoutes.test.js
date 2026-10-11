import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
let dir, server, base, storage, pc, mobile, userId;
const previousDir=process.env.DATA_DIR;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),'tennis-nowon-api-'));
  process.env.DATA_DIR=dir;vi.resetModules();
  const {app}=await import('../src/server.js');storage=await import('../src/storage.js');
  await storage.addInviteCode({code:'NOWON-MOCK'});const account=await storage.claimInviteCode({code:'NOWON-MOCK'});
  userId=account.user.id;pc=account.token;
  const link=await storage.createTelegramLinkToken(userId);await storage.connectTelegramLinkToken(link,'dry-run-chat');
  const {code}=await storage.createDeviceLinkCode(userId);mobile=(await storage.claimDeviceLinkCode({code})).token;
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
afterAll(async()=>{
  await new Promise(r=>server.close(r));
  if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(dir).startsWith('tennis-nowon-api-'))throw Error('Unsafe cleanup');
  await rm(dir,{recursive:true,force:true});if(previousDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previousDir;vi.resetModules();
});
const call=(token,url,method='GET',body)=>fetch(base+url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const input={venues:['nowon-madeul'],date:'2026-10-03',times:['18:00~19:00','19:00~20:00'],courts:['3'],durationMinutes:120};
it('exposes four facilities with separate court counts and no account fields',async()=>{
  const options=await(await call(pc,'/api/options')).json();
  expect(options.venues.filter(v=>v.provider==='nowon').map(v=>v.courts.length)).toEqual([9,4,3,3]);
  expect(options.providers.nowon).toMatchObject({pollingMinutes:5,supportsContinuousSlots:true});
  expect(JSON.stringify(options)).not.toMatch(/NOWON_PASSWORD|nowonUsername|nowonPassword|JSESSIONID/);
});
it('synchronizes Nowon court/duration settings between PC and mobile',async()=>{
  const result=await call(pc,'/api/watches','POST',input);expect(result.status).toBe(201);
  const {watch}=await result.json();expect(watch).toMatchObject({courts:['3'],durationMinutes:120,provider:'nowon'});
  expect((await(await call(mobile,'/api/watches')).json()).find(w=>w.id===watch.id)).toMatchObject(input);
  const changed=await call(mobile,'/api/watches/'+watch.id,'PATCH',{courts:['9'],durationMinutes:60});expect(changed.status).toBe(200);
  expect((await(await call(pc,'/api/watches')).json()).find(w=>w.id===watch.id)).toMatchObject({courts:['9'],durationMinutes:60});
  expect((await call(pc,'/api/watches/'+watch.id,'PATCH',{venues:['nowon-suraksan']})).status).toBe(400);
  expect((await call(pc,'/api/watches/'+watch.id,'PATCH',{enabled:false})).status).toBe(200);
  expect((await call(mobile,'/api/watches/'+watch.id,'DELETE')).status).toBe(204);
});
it('rejects nonexistent courts, non-adjacent two hours and mixed providers',async()=>{
  for(const bad of [{...input,venues:['nowon-suraksan'],courts:['9']},{...input,times:['18:00~19:00','20:00~21:00']},{...input,venues:['nowon-madeul','olympic']}])expect((await call(pc,'/api/watches','POST',bad)).status).toBe(400);
});
