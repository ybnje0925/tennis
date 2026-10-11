import { describe, it, expect, vi, afterEach } from "vitest";
import { canCheckMisaDate, filterMisaMonitoringWatches } from "../src/misaMonitoring.js";
import { checkHanamVenues } from "../src/providers/hanamProvider.js";
import { runCheckCycle, resetSchedulerRuntimeForTests } from "../src/monitor.js";
const at = time => new Date(time + "+09:00");
afterEach(() => { vi.unstubAllGlobals(); resetSchedulerRuntimeForTests(); });
describe("Misa reservation monitoring", () => {
  it.each([["08:59:59",false],["09:00:00",true],["17:59:59",true],["18:00:00",false]])("honors KST desk boundary %s", (time, expected) => {
    expect(canCheckMisaDate("2026-10-15", at("2026-10-12T" + time))).toBe(expected);
  });
  it.each([["2026-10-14",false],["2026-10-15",true],["2026-10-27",true],["2026-10-28",false]])("honors inclusive 3-15 day window %s", (date,expected) => {
    expect(canCheckMisaDate(date, at("2026-10-12T09:00:00"))).toBe(expected);
  });
  it.each(["2026-10-10", "2026-10-11", "2026-10-09", "2026-10-05", "2026-02-17", "2027-01-01"])("pauses on weekends, lunar and substitute holidays: %s", date => {
    const target = new Date(Date.parse(date + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0,10);
    expect(canCheckMisaDate(target,at(date + "T12:00:00"))).toBe(false);
  });
  it("compares calendar days across a year boundary and pauses for unknown holiday years", () => {
    expect(canCheckMisaDate("2027-01-04",at("2026-12-31T09:00:00"))).toBe(true);
    expect(canCheckMisaDate("2030-01-10",at("2030-01-07T09:00:00"))).toBe(false);
  });
  it("preserves other venues and the stored watch while Misa is paused", () => {
    const watches = [{ date:"2026-10-15",venues:["misa-all","hanam-tennis-1","olympic"] }];
    expect(filterMisaMonitoringWatches(watches,at("2026-10-11T12:00:00"))[0].venues).toEqual(["hanam-tennis-1","olympic"]);
    expect(watches[0].venues).toHaveLength(3);
    expect(filterMisaMonitoringWatches(watches,at("2026-10-12T09:00:00"))[0].venues).toHaveLength(3);
  });
  it("makes no HTTP requests for a paused direct provider check", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch",fetch);
    expect(await checkHanamVenues(["misa-all","misa-court-1"],{ now:at("2026-10-11T12:00:00"),venueDates:{"misa-all":["2026-10-15"],"misa-court-1":["2026-10-15"]} })).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("omits dates outside the booking window before requesting court pages", async () => {
    const fetch = vi.fn().mockResolvedValue({ok:true,text:async()=>'<tbody id="dynamicTbody"></tbody>'}); vi.stubGlobal("fetch",fetch);
    await checkHanamVenues(["misa-court-1"],{now:at("2026-10-12T09:00:00"),venueDates:{"misa-court-1":["2026-10-14","2026-10-15","2026-10-28"]}});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("searchResveDate=20261015");
  });
  it("never invokes the scheduler checker when only paused Misa watches exist", async () => {
    const current={watches:[{id:"w",userId:"u",enabled:true,date:"2026-10-15",venues:["misa-all"],times:["06:00~08:00"]}],users:[{id:"u",enabled:true,telegramConnected:true,telegramChatId:"test"}],system:{providers:{},venues:{},logs:[]},sentNotifications:{},lastAvailability:{}};
    const checker=vi.fn();
    await runCheckCycle({now:at("2026-10-11T12:00:00"),checker,stateLoader:async()=>current,stateSaver:async()=>{}});
    expect(checker).not.toHaveBeenCalled();
    expect(current.watches[0].enabled).toBe(true);
    expect(current.system.providers.hanam.active).toBe(false);
  });
});
