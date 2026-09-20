import { describe, it, expect } from 'vitest';
import { buildDashboard, recordVisit, recordEvent } from '../src/analytics.js';
const fixture = () => ({users:[{id:'u',name:'Tester',enabled:true,telegramConnected:true,telegramChatId:'secret'}],watches:[],inviteCodes:[]});
describe('admin analytics',()=>{
  it('groups reloads and activity into 30-minute visits across devices',()=>{
    const s=fixture();recordVisit(s,'u',true,'2026-09-20T00:00:00Z');recordVisit(s,'u',true,'2026-09-20T00:05:00Z');recordVisit(s,'u',false,'2026-09-20T00:34:00Z');recordVisit(s,'u',false,'2026-09-20T01:04:00Z');
    const d=buildDashboard(s,7,new Date('2026-09-20T02:00:00Z'));expect(d.summary.visits).toBe(2);expect(d.summary.pageViews).toBe(2);expect(d.users[0].visitDays).toBe(1);
  });
  it('uses Korean calendar boundaries and excludes future events',()=>{
    const s=fixture();recordVisit(s,'u',true,'2026-09-19T15:01:00Z');recordEvent(s,'telegram_sent',{userId:'u'},'2026-09-21T01:00:00Z');
    const d=buildDashboard(s,7,new Date('2026-09-20T02:00:00Z'));expect(d.daily.at(-1)).toMatchObject({date:'2026-09-20',visits:1,sent:0});expect(d.hours[0].visits).toBe(1);
  });
  it('counts each message once, preserves deleted watch history, excludes expired watches and secrets',()=>{
    const s=fixture();s.watches=[{id:'old',userId:'u',date:'2026-09-19',enabled:true,venues:['gangil'],times:['09:00~11:00']},{id:'new',userId:'u',date:'2026-09-21',enabled:true,venues:['gangil'],times:['09:00~11:00']}];
    recordEvent(s,'telegram_sent',{userId:'u',watchId:'deleted',venues:['gangil']},'2026-09-20T00:00:00Z');recordEvent(s,'watch_deleted',{userId:'u',watchId:'deleted'},'2026-09-20T00:00:00Z');
    const d=buildDashboard(s,7,new Date('2026-09-20T02:00:00Z'));expect(d.summary.activeWatches).toBe(1);expect(d.summary.sent).toBe(1);expect(d.users[0].deleted).toBe(1);expect(d.venues.find(v=>v.id==='gangil').users).toBe(1);expect(JSON.stringify(d)).not.toContain('secret');
  });
  it('does not invent past analytics for legacy state',()=>{const d=buildDashboard(fixture());expect(d.startedAt).toBeNull();expect(d.users[0].lastVisit).toBeNull();});
});
