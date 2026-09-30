import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
let dir,server,base,storage,pc,mobile,other,userId;
const previousDir=process.env.DATA_DIR;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),"tennis-myeonmok-api-"));
  process.env.DATA_DIR=dir; vi.resetModules();
  const {app}=await import("../src/server.js");
  storage=await import("../src/storage.js");
  await storage.addInviteCode({code:"MOCK-PC"});
  const account=await storage.claimInviteCode({code:"MOCK-PC"});
  userId=account.user.id;pc=account.token;
  const telegramToken=await storage.createTelegramLinkToken(userId);
  await storage.connectTelegramLinkToken(telegramToken,"mock-chat");
  const {code}=await storage.createDeviceLinkCode(userId);
  mobile=(await storage.claimDeviceLinkCode({code})).token;
  await storage.addInviteCode({code:"MOCK-OTHER"});
  other=(await storage.claimInviteCode({code:"MOCK-OTHER"})).token;
  server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  base="http://127.0.0.1:"+server.address().port;
});
afterAll(async()=>{
  await new Promise(resolve=>server.close(resolve));
  const resolved=path.resolve(dir);
  if (!resolved.startsWith(path.resolve(os.tmpdir())+path.sep) || !path.basename(resolved).startsWith("tennis-myeonmok-api-")) throw Error("Unsafe temporary cleanup");
  await rm(resolved,{recursive:true,force:true});
  if(previousDir===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previousDir;
  vi.resetModules();
});
const call=(token,url,method="GET",body)=>fetch(base+url,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
it("registers, edits, pauses and deletes the same condition across PC and mobile sessions",async()=>{
  const options=await (await call(pc,"/api/options")).json();
  expect(options.venueGroups.seasonal[0]).toMatchObject({id:"myeonmok",region:"서울 중랑구",slotMinutes:null});
  expect(options.providers.jungnang).toMatchObject({pollingMinutes:5,supportsCourtNumber:false});
  const created=await call(pc,"/api/watches","POST",{venues:["myeonmok"],date:"2026-10-01",times:["08:00~09:50"]});
  expect(created.status).toBe(201);
  const {watch}=await created.json();
  expect((await (await call(mobile,"/api/watches")).json())[0].id).toBe(watch.id);
  const changed=await call(mobile,"/api/watches/"+watch.id,"PATCH",{date:"2027-04-01",times:["17:00~18:50"]});
  expect(changed.status).toBe(200);
  expect((await (await call(pc,"/api/watches")).json())[0]).toMatchObject({date:"2027-04-01",times:["17:00~18:50"]});
  expect((await call(mobile,"/api/watches/"+watch.id,"PATCH",{date:"2027-03-31"})).status).toBe(400);
  expect((await call(other,"/api/watches/"+watch.id,"PATCH",{enabled:false})).status).toBe(400);
  expect((await call(pc,"/api/watches/"+watch.id,"PATCH",{enabled:false})).status).toBe(200);
  expect((await (await call(mobile,"/api/watches")).json())[0].enabled).toBe(false);
  expect((await call(mobile,"/api/watches/"+watch.id,"DELETE")).status).toBe(204);
  expect(await (await call(pc,"/api/watches")).json()).toEqual([]);
});
it("rejects a winter sixth session at the API boundary",async()=>{
  expect((await call(pc,"/api/watches","POST",{venues:["myeonmok"],date:"2026-10-01",times:["17:00~18:50"]})).status).toBe(400);
});
it("exposes only the user's selected cached sessions with separate attempt and success times",async()=>{
  const watch=await storage.addWatch({userId,provider:"jungnang",venues:["myeonmok"],date:"2026-10-01",times:["08:00~09:50"]});
  await storage.updateState(state=>{
    state.system.providers ||= {};
    state.system.providers.jungnang={lastAttemptAt:"2026-09-30T12:05:00Z",lastSuccessfulCheckAt:"2026-09-30T12:00:00Z",lastError:"offline"};
    state.system.myeonmokSnapshot={checkedAt:"2026-09-30T12:00:00Z",items:[
      {date:"2026-10-01",part:1,time:"08:00~09:50",availableCount:2,status:"예약가능"},
      {date:"2026-10-02",part:1,time:"08:00~09:50",availableCount:5,status:"예약가능"}
    ]};
  });
  const items=await (await call(mobile,"/api/watches")).json();
  expect(items.find(x=>x.id===watch.id).publicResult).toMatchObject({stale:true,lastAttemptAt:"2026-09-30T12:05:00Z",lastSuccessAt:"2026-09-30T12:00:00Z"});
  expect(items[0].publicResult.items).toHaveLength(1);
  expect(await (await call(other,"/api/watches")).json()).toEqual([]);
});
