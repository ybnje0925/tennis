import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let storage, server, base, a, b, dir;
const old=process.env.DATA_DIR;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),'tennis-delivery-'));process.env.DATA_DIR=dir;vi.resetModules();
  const {app}=await import('../src/server.js');storage=await import('../src/storage.js');
  for(const code of ['HISTORY-A','HISTORY-B']){await storage.addInviteCode({code});const account=await storage.claimInviteCode({code});if(code.endsWith('A'))a=account;else b=account;}
  await storage.updateState(state=>{
    state.deliveries=[{id:'private-a',userId:a.user.id,status:'sent',at:'2026-10-11T01:00:00Z',message:'only-a',items:[],attempts:[],telegramMessageId:777,chatId:'secret-chat',error:'secret-internal'}];
  });
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old;vi.resetModules();});
it('requires authentication, ignores userId overrides and never exposes private fields',async()=>{
  expect((await fetch(base+'/api/deliveries')).status).toBe(401);
  const response=await fetch(base+'/api/deliveries?userId='+a.user.id,{headers:{Authorization:'Bearer '+b.token}});
  expect(response.headers.get('cache-control')).toBe('no-store');expect((await response.json()).items).toEqual([]);
  const own=await (await fetch(base+'/api/deliveries',{headers:{Authorization:'Bearer '+a.token}})).json();
  expect(own.summary.total).toBe(1);expect(own.items[0].message).toBe('only-a');expect(JSON.stringify(own)).not.toMatch(/secret|777|userId/);
});
it('persists across a fresh storage module and server restart',async()=>{
  await new Promise(r=>server.close(r));vi.resetModules();
  const fresh=await import('../src/storage.js');expect((await fresh.loadState()).deliveries[0].message).toBe('only-a');
  const {app}=await import('../src/server.js');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
  const data=await (await fetch(base+'/api/deliveries',{headers:{Authorization:'Bearer '+a.token}})).json();expect(data.summary.total).toBe(1);
});
