import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
let server, base, dir, storage, monitor, a, b;
const previous = { DATA_DIR: process.env.DATA_DIR, ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN };
const headers = token => ({authorization: "Bearer " + token, "content-type":"application/json"});
const admin = {"x-admin-token":"member-test-admin", "content-type":"application/json"};
const call = (url, h, method="GET", body) => fetch(base+url, {method,headers:h, ...(body === undefined ? {} : {body:JSON.stringify(body)})});
beforeAll(async()=>{
  dir=await mkdtemp(path.join(os.tmpdir(),"tennis-members-"));
  process.env.DATA_DIR=dir; process.env.ADMIN_API_TOKEN="member-test-admin"; vi.resetModules();
  const {app}=await import("../src/server.js"); storage=await import("../src/storage.js"); monitor=await import("../src/monitor.js");
  for (const code of ["MEMBER-A","MEMBER-B"]) {
    await storage.addInviteCode({code});
    const account=await storage.claimInviteCode({code});
    const token=await storage.createTelegramLinkToken(account.user.id);
    await storage.connectTelegramLinkToken(token,"chat-"+code);
    if(code==="MEMBER-A")a=account;else b=account;
  }
  server=app.listen(0,"127.0.0.1"); await new Promise(resolve=>server.once("listening",resolve));
  base="http://127.0.0.1:"+server.address().port;
});
afterAll(async()=>{
  await new Promise(resolve=>server.close(resolve));
  await unlink(path.join(dir,"state.json")); await rmdir(dir);
  for(const [key,value] of Object.entries(previous)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  vi.resetModules();
});
it("registers unrestricted slots and matches both the first and last operating time",async()=>{
  const r=await call("/api/watches",headers(a.token),"POST",{venues:["gangil"],date:"2099-10-10",anyTime:true,times:[]});
  expect(r.status).toBe(201); const {watch}=await r.json();
  expect(watch).toMatchObject({anyTime:true}); expect(watch.times).toHaveLength(8);
  const state=await storage.loadState();
  expect(monitor.findNotifications(state,["06:00~08:00","20:00~22:00"].map(time=>({venue:"gangil",date:watch.date,time,available:true})))).toHaveLength(2);
  const limited=await call("/api/watches",headers(a.token),"POST",{venues:["gangil"],date:"2099-10-11",times:[]});
  expect(limited.status).toBe(400);
  const olympic=await call("/api/watches",headers(b.token),"POST",{venues:["olympic"],date:"2099-10-10",anyTime:true});
  expect((await olympic.json()).watch.times).toHaveLength(16);
  const seasonal=await call("/api/watches",headers(a.token),"POST",{venues:["myeonmok"],date:"2099-10-10",anyTime:true});
  const {watch:season}=await seasonal.json(); expect(season.times).toHaveLength(5);
  const changed=await call("/api/watches/"+season.id,headers(a.token),"PATCH",{date:"2099-04-10"});
  expect((await changed.json()).times).toHaveLength(6);
});
it("filters shared logs, other dates, other notifications and provider data at the API boundary",async()=>{
  await storage.updateState(state=>{
    const date=new Date();
    monitor.addLog(state,"강동 송파 올림픽 다른 사용자 정보",date,{kind:"provider-error",
      watchTargets: state.watches.map(w => ({watchId:w.id,userId:w.userId,venueIds:w.venues,date:w.date})), facilities:[
      {venueId:"gangil",provider:"gangdong",status:"checked"},{venueId:"olympic",provider:"olympic",status:"failed"}],
      errors:[{provider:"songpa",venueId:"songpa-oryun",targetDate:"2099-10-10",message:"OTHER-VENUE"},
      {provider:"olympic",venueId:"olympic",targetDate:"2099-10-12",message:"OTHER-DATE"},
      {provider:"olympic",venueId:"olympic",targetDate:"2099-10-10",message:"MY-ERROR"}],
      notificationErrors:[{userId:a.user.id,message:"OTHER-USER"}]});
    monitor.addLog(state,"올림픽 다른 사람만 조회",date,{kind:"provider-check",
      watchTargets:[{watchId:"other-watch",userId:a.user.id,venueIds:["olympic"],date:"2099-10-13"}],
      facilities:[{venueId:"olympic",provider:"olympic",status:"checked"}]});
    state.system.providers={gangdong:{id:"gangdong",lastError:"OTHER-GLOBAL"},olympic:{id:"olympic",lastError:"OTHER-DATE"}};
  });
  const status=await (await call("/api/status",headers(b.token))).json();
  expect(status.logDetails).toHaveLength(1);
  expect(status.logDetails[0].facilities.map(f=>f.venueId)).toEqual(["olympic"]);
  expect(status.logDetails[0].errors.map(e=>e.message)).toEqual(["MY-ERROR"]);
  expect(status.logDetails[0].notificationErrors).toEqual([]);
  expect(Object.keys(status.providers)).toEqual(["olympic"]);
  for(const text of ["강동","송파","OTHER-VENUE","OTHER-DATE","OTHER-USER","OTHER-GLOBAL"])expect(JSON.stringify(status)).not.toContain(text);
});
it("restricts invite changes to admin and rejects claims of disabled unused codes",async()=>{
  await storage.addInviteCode({code:"UNUSED-MEMBER"});
  expect((await call("/api/admin/invites/UNUSED-MEMBER",headers(a.token),"PATCH",{enabled:false})).status).toBe(403);
  expect((await call("/api/admin/invites/UNUSED-MEMBER",admin,"PATCH",{enabled:false})).status).toBe(200);
  expect((await call("/api/invite/claim",{"content-type":"application/json"},"POST",{code:"UNUSED-MEMBER"})).status).toBe(400);
  expect((await call("/api/admin/invites/MEMBER-A",admin,"PATCH",{enabled:false})).status).toBe(400);
});
it("blocks existing sessions, pending links and watches; reactivation keeps alerts off",async()=>{
  const link=await storage.createDeviceLinkCode(a.user.id);
  expect((await call("/api/admin/users/"+a.user.id,headers(b.token),"PATCH",{enabled:false})).status).toBe(403);
  expect((await call("/api/admin/users/"+a.user.id,admin,"PATCH",{enabled:"false"})).status).toBe(400);
  expect((await call("/api/admin/users/"+a.user.id,admin,"PATCH",{enabled:false})).status).toBe(200);
  expect((await call("/api/watches",headers(a.token))).status).toBe(401);
  expect((await call("/api/device-link/claim",{"content-type":"application/json"},"POST",{code:link.code})).status).toBe(400);
  expect(monitor.getActiveWatches(await storage.loadState()).some(w=>w.userId===a.user.id)).toBe(false);
  expect((await call("/api/admin/users/"+a.user.id,admin,"PATCH",{enabled:true})).status).toBe(200);
  expect((await call("/api/watches",headers(a.token))).status).toBe(200);
  expect((await storage.loadState()).watches.filter(w=>w.userId===a.user.id).every(w=>w.enabled===false)).toBe(true);
});

it("keeps a real Olympic success log through persistence even with an unrelated duplicate diagnostic",async()=>{
  const watch=(await storage.loadState()).watches.find(w=>w.userId===b.user.id&&w.venues.includes("olympic"));
  await storage.updateState(state=>{
    monitor.addLog(state,"조회완료 | 올림픽 1/1 성공",new Date(),{
      watchTargets:[{watchId:watch.id,userId:b.user.id,venueIds:["olympic"],date:watch.date}],
      facilities:[{venueId:"olympic",provider:"olympic",status:"checked",count:0}],
      errors:[{provider:"songpa",type:"DUPLICATE_SKIPPED",message:"UNRELATED-DUPLICATE"}]
    });
  });
  // Read twice: normalization used to permanently discard this record.
  await storage.loadState();
  const status=await (await call("/api/status",headers(b.token))).json();
  expect(status.logDetails.at(-1).facilities).toEqual([{venueId:"olympic",provider:"olympic",status:"checked",count:0}]);
  expect(status.logDetails.at(-1).errors).toEqual([]);
  expect(status.logs.at(-1)).toContain("올림픽");
  expect(JSON.stringify(status)).not.toContain("UNRELATED-DUPLICATE");
});
