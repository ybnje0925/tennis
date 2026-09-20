import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
let server, base, dir, storage, userToken;
const previousDir=process.env.DATA_DIR, previousAdmin=process.env.ADMIN_API_TOKEN;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),'tennis-admin-test-'));
  process.env.DATA_DIR=dir;process.env.ADMIN_API_TOKEN='test-admin-token';vi.resetModules();
  const {app}=await import('../src/server.js');storage=await import('../src/storage.js');
  await storage.addInviteCode({code:'TEST-CODE'});userToken=(await storage.claimInviteCode({code:'TEST-CODE',name:'Tester'})).token;
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{
  await new Promise(resolve=>server.close(resolve));
  await unlink(path.join(dir,'state.json'));await rmdir(dir);
  if(previousDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previousDir;
  if(previousAdmin===undefined)delete process.env.ADMIN_API_TOKEN;else process.env.ADMIN_API_TOKEN=previousAdmin;
  vi.resetModules();
});
it('blocks anonymous and ordinary user dashboard access',async()=>{
  expect((await fetch(base+'/api/admin/dashboard')).status).toBe(403);
  expect((await fetch(base+'/api/admin/dashboard',{headers:{authorization:`Bearer ${userToken}`}})).status).toBe(403);
  expect((await fetch(base+'/api/admin/dashboard',{headers:{'x-admin-token':'wrong'}})).status).toBe(403);
});
it('tracks authenticated visits and deleted watches through to protected dashboard',async()=>{
  expect((await fetch(base+'/api/analytics/visit',{method:'POST'})).status).toBe(401);
  const headers={authorization:`Bearer ${userToken}`,'content-type':'application/json'};
  for(let i=0;i<2;i++)expect((await fetch(base+'/api/analytics/visit',{method:'POST',headers,body:JSON.stringify({pageView:true})})).status).toBe(204);
  const state=await storage.loadState();const userId=state.users[0].id;
  const watch=await storage.addWatch({userId,venues:['gangil'],date:'2099-01-01',times:['09:00~11:00']});await storage.deleteWatch(watch.id,userId);
  const response=await fetch(base+'/api/admin/dashboard?days=7',{headers:{'x-admin-token':'test-admin-token'}});const body=await response.json();
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
  expect(body.summary).toMatchObject({users:1,visits:1,pageViews:2});expect(body.users[0]).toMatchObject({created:1,deleted:1});
  expect(JSON.stringify(body)).not.toContain('tokenHash');expect(body.users[0]).not.toHaveProperty('telegramChatId');
  expect((await fetch(base+'/api/admin/dashboard?days=999',{headers:{'x-admin-token':'test-admin-token'}})).status).toBe(400);
});
