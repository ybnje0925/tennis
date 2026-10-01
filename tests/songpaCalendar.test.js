import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseSongpaCalendarHtml, checkSongpaVenue, isSongpaLoginPage, isSongpaLoggedIn } from "../src/providers/songpaProvider.js";
import { parseLegacyCalendarHtml } from "../src/legacyHttpParser.js";

const september=readFileSync(new URL("./fixtures/songpa-oryun-public.html",import.meta.url),"utf8");
const fixtures=Object.fromEntries(["oryun","seongnaecheon","songpa","ogeum"].map(id=>[id,readFileSync(new URL("./fixtures/songpa-"+id+"-october.html",import.meta.url),"utf8")]));
describe("actual Songpa responses",()=>{
  it("recognizes all current-day 접수불가 slots and past-day blocked states",()=>{
    const items=parseSongpaCalendarHtml(september,"songpa-oryun");
    expect(items.filter(x=>x.date==="2026-09-30")).toHaveLength(8);
    expect(items.filter(x=>x.date==="2026-09-30").every(x=>x.status==="접수불가" && !x.available)).toBe(true);
    expect(items.find(x=>x.date==="2026-09-23")).toMatchObject({status:"예약불가",available:false});
    expect(items.filter(x=>x.date==="2026-09-25")).toEqual([]);
    expect(items.calendarMonth).toBe("2026-09");
    expect(items.calendarDates).toContain("2026-09-25");
  });
  it.each(["oryun","seongnaecheon","songpa","ogeum"])("parses authenticated October %s without inventing capacities",id=>{
    const venueId="songpa-"+id;
    const items=parseSongpaCalendarHtml(fixtures[id],venueId);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(x=>x.date.startsWith("2026-10-"))).toBe(true);
    expect(items.some(x=>x.available)).toBe(true);
    for(const item of items.filter(x=>x.available))expect(item.availableCount).toBe(item.totalCount-item.reservedCount);
    expect(items).toEqual(parseLegacyCalendarHtml(fixtures[id],venueId,"songpa"));
    expect(fixtures[id]).not.toMatch(/PHPSESSID|mb_id|g5_remote_addr/);
  });
  function mockPage(){
    let current=september;
    const page={
      goto:vi.fn(async url=>{current=url.includes("sch_sym=2026-10")?fixtures.oryun:september;return {status:()=>200};}),
      waitForLoadState:vi.fn(async()=>{}),
      url:()=> "https://spc.esongpa.or.kr/page/rent/s04.od.list.php",
      content:async()=>current,
      locator:()=>({innerText:async()=> "로그아웃 마이페이지 예약현황"})
    };
    return page;
  }
  it("requests each needed month once, filters exact target dates and sorts",async()=>{
    const page=mockPage();
    const items=await checkSongpaVenue(page,"songpa-oryun",{dates:["2026-10-05","2026-09-23","2026-09-25","2026-09-26","2026-10-04","2026-10-04"]});
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.goto.mock.calls[0][0]).toContain("sch_sym=2026-09");
    expect(page.goto.mock.calls[1][0]).toContain("sch_sym=2026-10");
    expect(items.some(x=>x.date==="2026-10-04")).toBe(true);
    expect(items.every(x=>["2026-09-23","2026-10-04","2026-10-05"].includes(x.date))).toBe(true);
    expect(items).toEqual([...items].sort((a,b)=>(a.date+a.startTime).localeCompare(b.date+b.startTime)));
  });
  it("accepts a holiday calendar cell as no published slots, without inventing zero availability",async()=>{
    expect(await checkSongpaVenue(mockPage(),"songpa-oryun",{dates:["2026-09-25"]})).toEqual([]);
  });
  it("rejects a server that ignores the month parameter",async()=>{
    const page=mockPage();page.goto=vi.fn(async()=>({status:()=>200}));
    await expect(checkSongpaVenue(page,"songpa-oryun",{dates:["2026-10-04"]})).rejects.toMatchObject({type:"CALENDAR_DATE_NOT_FOUND"});
  });
  it("fails malformed slots rather than hiding them as no vacancies",()=>{
    const html=fixtures.oryun.replace("예약가능","변경된 상태");
    expect(()=>parseSongpaCalendarHtml(html,"songpa-oryun")).toThrow("회차 상태");
    expect(()=>parseSongpaCalendarHtml("<form id='flogin'>로그인</form>","songpa-oryun")).toThrow("연월");
  });
});

describe("Songpa authentication detection", () => {
  it("does not mistake login navigation or guidance for a login form", async () => {
    const page = {
      goto: vi.fn(async () => ({ status: () => 200 })),
      waitForLoadState: vi.fn(async () => {}),
      url: () => "https://spc.esongpa.or.kr/page/rent/s04.od.list.php",
      content: async () => fixtures.oryun,
      locator: () => ({ innerText: async () => "로그인 아이디 비밀번호 로그인 후 이용 예약현황" })
    };
    expect(await checkSongpaVenue(page, "songpa-oryun", { dates: ["2026-10-04"] })).toEqual(parseSongpaCalendarHtml(fixtures.oryun, "songpa-oryun").filter(x => x.date === "2026-10-04"));
  });
  it("rejects real login forms, redirects and protection messages", () => {
    expect(isSongpaLoginPage({ html: '<form id="flogin"><input name="mb_password" type="password"></form>' })).toBe(true);
    expect(isSongpaLoginPage({ url: "https://spc.esongpa.or.kr/bbs/login.php?url=x", html: fixtures.oryun })).toBe(true);
    expect(isSongpaLoginPage({ body: "비정상적인 접근입니다" })).toBe(true);
    expect(isSongpaLoginPage({ body: "로그인 예약현황" })).toBe(false);
  });
  it("does not trust member navigation shared with anonymous visitors", async () => {
    const page = { goto: vi.fn(async () => {}), locator: () => ({ innerText: async () => "로그인 마이페이지 대관결제내역 정보수정" }) };
    expect(await isSongpaLoggedIn(page)).toBe(false);
    page.locator = () => ({ innerText: async () => "로그아웃 마이페이지" });
    expect(await isSongpaLoggedIn(page)).toBe(true);
  });
});
