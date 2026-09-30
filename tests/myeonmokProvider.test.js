import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseMyeonmokHtml, checkMyeonmokVenues } from "../src/providers/myeonmokProvider.js";
import { myeonmokSlots } from "../public/myeonmokSlots.js";
import { buildMyeonmokMessage } from "../src/telegramNotifier.js";
import { findNotifications, keyFor, resetSchedulerRuntimeForTests, runCheckCycle } from "../src/monitor.js";
import { CHECK_META } from "../src/checker.js";
import { addWatch } from "../src/storage.js";

const fixture = readFileSync(new URL("./fixtures/myeonmok-public.html", import.meta.url), "utf8");
const page = (today, cells) => '<div class="calendar1_yearmonth">오늘은 ' + today + '</div><div class="calendar1_table"><table>' +
  cells.map(([date, content]) => '<td><h6>' + date.slice(5).replace("-", ".") + '</h6><ul>' + content + '</ul></td>').join("") + '</table></div><div class="anker-wrap">';
const li = (part, status) => "<li>" + part + "부<span>" + status + "</span></li>";
const response = html => ({ok:true, url:"https://tennis.jungnangimc.or.kr/page/rent/s01.od.list.php", headers:new Headers({"content-type":"text/html; charset=utf-8"}), text:async()=>html});
beforeEach(() => resetSchedulerRuntimeForTests());

describe("면목 공개 HTTP 달력", () => {
  it("uses the recorded public response with no personal data", () => {
    expect(fixture).not.toMatch(/PHPSESSID|g5_remote_addr|g5_ss_mb_id/);
    const items = parseMyeonmokHtml(fixture);
    expect(items.find(x=>x.date==="2026-09-30" && x.part===6)).toMatchObject({time:"17:00~18:50",available:false,status:"예약불가"});
    expect(items.find(x=>x.date==="2026-10-01" && x.part===5)).toMatchObject({time:"16:00~17:00",durationMinutes:60, availableCount:5});
    expect(items.some(x=>x.date==="2026-10-01" && x.part===6)).toBe(false);
    expect(items).toEqual([...items].sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime)));
    expect(items.every(x=>!x.courtNo)).toBe(true);
  });
  it.each([[0,5,5],[3,5,2],[4,5,1],[3,9,6]])("calculates booked %i / capacity %i as remaining %i", (booked,capacity,remaining)=>{
    const item=parseMyeonmokHtml(page("2026-10-01",[["2026-10-01",li(1,"예약가능 ("+booked+"/"+capacity+")")]]))[0];
    expect(item).toMatchObject({available:true,bookedCount:booked,capacity,availableCount:remaining});
  });
  it("separates closed, unavailable, unopened, empty and unknown states",()=>{
    const items=parseMyeonmokHtml(page("2026-10-01",[
      ["2026-10-01",li(1,"예약완료")+li(2,"미오픈")+li(3,"상태변경")],
      ["2026-10-02","<li>휴장</li>"],["2026-10-03","<li></li>"]
    ]),["2026-10-01","2026-10-02","2026-10-03","2026-11-01"]);
    expect(items.find(x=>x.part===1)).toMatchObject({status:"예약완료",available:false,availableCount:0});
    expect(items.find(x=>x.part===2)).toMatchObject({status:"미오픈",available:false,availableCount:null});
    expect(items.find(x=>x.part===3)).toMatchObject({status:"상태 확인 불가",available:null});
    expect(items.find(x=>x.date==="2026-10-02")).toMatchObject({status:"휴장",available:false});
    expect(items.find(x=>x.date==="2026-10-03")).toMatchObject({status:"조회 범위 밖 또는 상태 확인 불가",available:null,availableCount:null});
    expect(items.find(x=>x.date==="2026-11-01")).toMatchObject({available:null});
  });
  it.each([
    ["2026-09-30","2026-10-01","16:00~17:00"],
    ["2026-03-31","2026-04-01","15:00~16:50"],
    ["2026-12-31","2027-01-01","16:00~17:00"]
  ])("maps dates across %s to %s", (today,next,winterOrSummer)=>{
    const items=parseMyeonmokHtml(page(today,[[today,li(1,"예약완료")],[next,li(5,"예약가능 (3/5)")]]));
    expect(items.find(x=>x.date===next && x.part===5)).toMatchObject({time:winterOrSummer,availableCount:2});
  });
  it("does not correct explicit official times and exposes the discrepancy",()=>{
    const items=parseMyeonmokHtml(page("2026-10-01",[["2026-10-01",li(1,"08:10~09:40 예약가능 (3/5)")]]));
    expect(items[0]).toMatchObject({time:"08:10~09:40",timeSource:"공식 응답",durationMinutes:90});
    expect(items[0].warning).toContain("불일치");
  });
  it("fails changed structure, missing counts, invalid count and a login form",()=>{
    for(const html of ["<form id='flogin'>로그인</form>",page("2026-10-01",[]),
      page("2026-10-01",[["2026-10-01",li(1,"예약가능")]]),
      page("2026-10-01",[["2026-10-01",li(1,"예약가능 (6/5)")]]),
      page("2026-10-01",[["2026-10-01",li(6,"예약완료")]])]) {
      expect(()=>parseMyeonmokHtml(html)).toThrow();
    }
  });
  it("validates winter selections at the storage boundary before writing",async()=>{
    expect(myeonmokSlots("2026-02-30")).toEqual([]);
    await expect(addWatch({venues:["myeonmok"],date:"2026-10-01",times:["17:00~18:50"]})).rejects.toThrow("회차");
    await expect(addWatch({venues:["myeonmok","gangil"],date:"2026-10-01",times:["08:00~09:50"]})).rejects.toThrow("별도로");
  });
  it("fetches one list for multiple dates and skips unused facilities",async()=>{
    const fetchImpl=vi.fn(async()=>response(fixture));
    await checkMyeonmokVenues([], {fetchImpl});
    expect(fetchImpl).not.toHaveBeenCalled();
    const result=await checkMyeonmokVenues(["myeonmok","myeonmok"],{venueDates:{myeonmok:["2026-10-01","2026-10-02"]},fetchImpl});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Set(result.myeonmok.map(x=>x.date)).size).toBe(2);
  });
  it("limits network retries and treats parser/login failures as errors",async()=>{
    const fetchImpl=vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(response(fixture));
    const sleep=vi.fn();
    const success=await checkMyeonmokVenues(["myeonmok"],{fetchImpl,sleep});
    expect(success.myeonmok.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);expect(sleep).toHaveBeenCalledWith(750);
    const broken=vi.fn(async()=>response("<form id='flogin'>login</form>"));
    const result=await checkMyeonmokVenues(["myeonmok"],{fetchImpl:broken,sleep});
    expect(result).not.toHaveProperty("myeonmok");
    expect(result[CHECK_META].errors[0].type).toBe("LOGIN_OR_PROTECTION_PAGE");
    expect(broken).toHaveBeenCalledTimes(1);
    const offline=vi.fn(async()=>{throw Error("network");});
    const failed=await checkMyeonmokVenues(["myeonmok"],{fetchImpl:offline,sleep});
    expect(offline).toHaveBeenCalledTimes(2);expect(failed[CHECK_META].errors).toHaveLength(1);
  });
});

describe("면목 공유 조회와 재알림",()=>{
  const item=()=>parseMyeonmokHtml(fixture,["2026-10-01"]).find(x=>x.part===1);
  function runner() {
    const watches=["u1","u2"].map((userId,i)=>({id:"w"+i,userId,provider:"jungnang",venues:["myeonmok"],date:"2026-10-01",times:["08:00~09:50"],enabled:true}));
    let current={users:["u1","u2"].map(id=>({id,enabled:true,telegramConnected:true,telegramChatId:"mock-"+id})),watches,lastAvailability:{},sentNotifications:{},system:{venues:{},logs:[]}};
    const notifier=vi.fn(async()=>{});
    let mode="available";
    const checker=vi.fn(async ({watches})=>{
      expect(watches).toHaveLength(2);
      if(mode==="failed"){const r={};Object.defineProperty(r,CHECK_META,{value:{errors:[{provider:"jungnang",venueId:"myeonmok",type:"NETWORK_ERROR",message:"offline"}]}});return r;}
      return {myeonmok:[mode==="unknown"?{...item(),available:null,status:"상태 확인 불가"}:mode==="closed"?{...item(),available:false,status:"예약완료",availableCount:0}:item()]};
    });
    return {get current(){return current;},set mode(value){mode=value;},notifier,checker,
      async cycle(){return runCheckCycle({checker,notifier,stateLoader:async()=>structuredClone(current),stateSaver:async next=>{current=structuredClone(next);},targetProviderIds:["jungnang"],forceDue:true,now:new Date("2026-09-30T10:00:00Z")});}};
  }
  it("shares each check between users, suppresses duplicates, preserves errors/unknowns, and re-alerts after closure",async()=>{
    const r=runner();
    await r.cycle();expect(r.checker).toHaveBeenCalledTimes(1);expect(r.notifier).toHaveBeenCalledTimes(2);
    await r.cycle();expect(r.notifier).toHaveBeenCalledTimes(2);
    const success=r.current.system.myeonmokSnapshot.checkedAt;
    r.mode="failed";await r.cycle();
    expect(r.current.lastAvailability[keyFor(item())].available).toBe(true);
    expect(r.current.system.myeonmokSnapshot.checkedAt).toBe(success);
    expect(r.current.system.providers.jungnang.lastError).toContain("offline");
    r.mode="available";await r.cycle();expect(r.notifier).toHaveBeenCalledTimes(2);
    r.mode="unknown";await r.cycle();expect(r.current.lastAvailability[keyFor(item())].available).toBe(true);
    r.mode="available";await r.cycle();expect(r.notifier).toHaveBeenCalledTimes(2);
    r.mode="closed";await r.cycle();
    expect(r.current.lastAvailability[keyFor(item())].available).toBe(false);
    r.mode="available";await r.cycle();expect(r.notifier).toHaveBeenCalledTimes(4);
  });
  it("keeps actual times in alerts and uses Seoul weekdays and remaining teams",()=>{
    const message=buildMyeonmokMessage([{...item(),part:5,time:"16:00~17:00",availableCount:2}]);
    expect(message).toContain("면목구립테니스장");expect(message).toContain("(목)");
    expect(message).toContain("5부 16:00~17:00 · 잔여 2팀");
    expect(message).toContain("실제 신청 가능 여부는 공식 사이트에서 확인");
    expect(message).toContain("https://tennis.jungnangimc.or.kr");
  });
});
