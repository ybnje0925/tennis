import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateNowonRows, filterNowonSlotsByWatch, nowonKeyFor } from '../src/providers/nowonSlots.js';
import { checkNowonVenues } from '../src/providers/nowonProvider.js';
import { validateNowonWatch, NOWON_FACILITIES } from '../public/nowonRules.js';
import { runCheckCycle, resetSchedulerRuntimeForTests } from '../src/monitor.js';
import { buildNowonMessage } from '../src/telegramNotifier.js';
const date='2026-10-03', venue='nowon-madeul';
// Synthetic normalized rows. NOT authenticated site HTML or verified selectors.
const row=(overrides={})=>({cate2:'16',date,courtNo:'3',startTime:'18:00',endTime:'19:00',display:'blue',checkbox:true,...overrides});
const parse=rows=>validateNowonRows(rows,{venueId:venue,date});
const watch=(overrides={})=>({id:'w1',userId:'u1',provider:'nowon',venues:[venue],date,times:['18:00~19:00','19:00~20:00'],durationMinutes:120,courts:['3'],enabled:true,...overrides});
beforeEach(resetSchedulerRuntimeForTests);
describe('Nowon normalized states and matching (synthetic)',()=>{
  it('uses per-facility official identifiers and court counts',()=>{
    expect(Object.values(NOWON_FACILITIES).map(x=>[x.cate2,x.courtCount])).toEqual([['16',9],['17',4],['15',3],['117',3]]);
    expect(()=>validateNowonRows([row({cate2:'117',courtNo:'4'})],{venueId:'nowon-suraksan',date})).toThrow();
    expect(()=>parse([row({date:'2026-10-04'})])).toThrow();
  });
  it('red strike stays unavailable despite calendar label or checkbox',()=>{
    const slots=parse([row({display:'red-strike',calendarStatus:'예약가능'})]);
    expect(slots[0].available).toBe(false);expect(filterNowonSlotsByWatch(slots,watch({durationMinutes:60}))).toEqual([]);
  });
  it('blue matches one hour on the requested court',()=>{
    const slots=parse([row()]);expect(filterNowonSlotsByWatch(slots,watch({durationMinutes:60}))).toHaveLength(1);
    expect(filterNowonSlotsByWatch(slots,watch({courts:['4'],durationMinutes:60}))).toEqual([]);
  });
  it('joins two adjacent blue hours only on the same court',()=>{
    const slots=parse([row(),row({startTime:'19:00',endTime:'20:00'})]);
    expect(filterNowonSlotsByWatch(slots,watch())[0]).toMatchObject({courtNo:'3',time:'18:00~20:00',durationMinutes:120});
    expect(filterNowonSlotsByWatch(parse([row(),row({courtNo:'4',startTime:'19:00',endTime:'20:00'})]),watch({courts:[]}))).toEqual([]);
  });
  it('does not join a red or missing hour or extend beyond desired hours',()=>{
    expect(filterNowonSlotsByWatch(parse([row(),row({display:'red-strike',startTime:'19:00',endTime:'20:00'})]),watch())).toEqual([]);
    expect(filterNowonSlotsByWatch(parse([row()]),watch())).toEqual([]);
    expect(filterNowonSlotsByWatch(parse([row(),row({startTime:'19:00',endTime:'20:00'})]),watch({times:['18:00~19:00']}))).toEqual([]);
  });
  it('fails closed on blue/unavailable conflicts, unknown states and duplicates',()=>{
    expect(()=>parse([row({disabled:true})])).toThrow('충돌');
    expect(()=>parse([row({explicitUnavailable:true})])).toThrow('충돌');
    expect(()=>parse([row({display:'unknown'})])).toThrow('상태');
    expect(()=>parse([row(),row()])).toThrow('매핑');
  });
  it('validates saved court and continuous-time constraints',()=>{
    expect(()=>validateNowonWatch(watch())).not.toThrow();
    expect(()=>validateNowonWatch(watch({venues:[venue,'nowon-suraksan'],courts:['9']}))).toThrow('코트');
    expect(()=>validateNowonWatch(watch({times:['18:00~19:00']}))).toThrow('인접');
    expect(()=>validateNowonWatch(watch({venues:[venue,'olympic']}))).toThrow('별도');
  });
  it('produces safe dated Telegram text without sending anything',()=>{
    const item=filterNowonSlotsByWatch(parse([row(),row({startTime:'19:00',endTime:'20:00'})]),watch())[0];
    const text=buildNowonMessage([item]);expect(text).toContain('(토)');expect(text).toContain('3코트');expect(text).toContain('연속 2시간');expect(text).toContain('본인 계정');expect(text).not.toMatch(/jsessionid|cookie|token/i);
  });
});
describe('shared checks and notification recovery',()=>{
  it('does no upstream work without config and gates unverified production parsing',async()=>{
    const loadDay=vi.fn();const result=await checkNowonVenues([venue],{venueDates:{[venue]:[date]},credentialsConfigured:false,loadDay});
    expect(loadDay).not.toHaveBeenCalled();expect(result[Symbol.for('tennis.checkMeta')].errors[0].type).toBe('NOWON_LOGIN_CONFIG_REQUIRED');
    const gated=await checkNowonVenues([venue],{venueDates:{[venue]:[date]},credentialsConfigured:true});
    expect(gated[Symbol.for('tennis.checkMeta')].errors[0].type).toBe('NOWON_STRUCTURE_UNVERIFIED');expect(gated).not.toHaveProperty(venue);
  });
  it('shares a pending day, deduplicates targets and refreshes next cycle',async()=>{
    let release;const loadDay=vi.fn(()=>new Promise(resolve=>{release=()=>resolve([row()]);}));
    const args={venueDates:{[venue]:[date,date]},credentialsConfigured:true,loadDay};
    const a=checkNowonVenues([venue,venue],args),b=checkNowonVenues([venue],args);
    await vi.waitFor(()=>expect(loadDay).toHaveBeenCalledTimes(1));release();await Promise.all([a,b]);
    const c=checkNowonVenues([venue],args);await vi.waitFor(()=>expect(loadDay).toHaveBeenCalledTimes(2));release();await c;
  });
  it('never returns a successful empty result on a failed day',async()=>{
    const result=await checkNowonVenues([venue],{venueDates:{[venue]:[date]},credentialsConfigured:true,loadDay:async()=>{throw Error('mock-failure');}});
    expect(result).not.toHaveProperty(venue);expect(result[Symbol.for('tennis.checkMeta')].errors).toHaveLength(1);
  });
  it('shares results across users, preserves sent state over errors, rearms only on closure',async()=>{
    let current={users:[{id:'u1',telegramConnected:true,telegramChatId:'mock-one',enabled:true},{id:'u2',telegramConnected:true,telegramChatId:'mock-two',enabled:true}],watches:[watch(),watch({id:'w2',userId:'u2'})],lastAvailability:{},sentNotifications:{},system:{venues:{},providers:{},logs:[]}};
    const notifier=vi.fn(async()=>{});let rows=[row(),row({startTime:'19:00',endTime:'20:00'})];let failure=false;
    const loadDay=vi.fn(async()=>{if(failure)throw Error('mock detail failure');return rows;});
    const checker=async()=>checkNowonVenues([venue],{venueDates:{[venue]:[date]},loadDay,credentialsConfigured:true});
    const run=()=>runCheckCycle({checker,notifier,stateLoader:async()=>structuredClone(current),stateSaver:async state=>{current=structuredClone(state);},source:'manual',targetProviderIds:['nowon'],forceDue:true,now:new Date('2026-10-02T04:00:00Z')});
    await run();expect(notifier).toHaveBeenCalledTimes(2);expect(loadDay).toHaveBeenCalledTimes(1);
    const key=nowonKeyFor(filterNowonSlotsByWatch(parse(rows),watch())[0]);expect(current.lastAvailability[key].available).toBe(true);
    await run();expect(notifier).toHaveBeenCalledTimes(2);
    failure=true;await run();expect(current.lastAvailability[key].available).toBe(true);expect(notifier).toHaveBeenCalledTimes(2);
    failure=false;await run();expect(notifier).toHaveBeenCalledTimes(2);
    rows=[row(),row({display:'red-strike',startTime:'19:00',endTime:'20:00'})];await run();expect(current.lastAvailability[key].available).toBe(false);
    rows=[row(),row({startTime:'19:00',endTime:'20:00'})];await run();expect(notifier).toHaveBeenCalledTimes(4);
  });
});
