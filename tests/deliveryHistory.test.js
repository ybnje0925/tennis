import { describe, it, expect, vi, afterEach } from 'vitest';
import { beginDelivery, finishDelivery, deliveryHistory } from '../src/deliveryHistory.js';
const watch = { id: 'w', userId: 'a' };
const group = { watch, notifications: ['18:00~20:00','20:00~22:00'].map(time => ({ watch, key: time, item: { venue: 'gangil', date: '2099-10-11', time } })) };
afterEach(() => vi.resetModules());
describe('delivery journal', () => {
  it('counts one digest once, links failed retry, uses Seoul midnight and excludes other users', () => {
    const state = {};
    const id = beginDelivery(state, group, 'original', '2026-10-10T14:59:59Z');
    finishDelivery(state, id, 'failed', null, '2026-10-10T14:59:59Z');
    expect(deliveryHistory(state,'a',{},new Date('2026-10-10T15:00:00Z')).summary.total).toBe(0);
    expect(beginDelivery(state, group, 'original', '2026-10-10T15:00:01Z')).toBe(id);
    finishDelivery(state, id, 'sent', {result:{message_id:10}}, '2026-10-10T15:00:02Z');
    const data = deliveryHistory(state,'a',{},new Date('2026-10-10T15:00:03Z'));
    expect(data.summary).toMatchObject({ total:1, today:1 });
    expect(data.items).toHaveLength(1); expect(data.items[0].attempts).toHaveLength(2);
    expect(data.items[0].items).toHaveLength(2); expect(data.items[0].message).toBe('original');
    expect(deliveryHistory(state,'a',{},new Date('2026-10-11T15:00:00Z')).summary.today).toBe(0);
    expect(deliveryHistory(state,'b').items).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/telegramMessageId|chatId|token|keys|userId/);
    const second = beginDelivery(state,group,'new occurrence');
    expect(second).not.toBe(id);
  });
  it('blocks pending outcomes after a restart and never reports them as successful', () => {
    const state = {}; beginDelivery(state,group,'uncertain');
    const restarted=JSON.parse(JSON.stringify(state));
    expect(beginDelivery(restarted,group,'retry')).toBeNull();
    expect(deliveryHistory(restarted,'a').summary).toMatchObject({total:0,uncertain:1});
  });
  it('uses only attributable old successes and bounds responses to 20 messages', () => {
    const state = { analytics:{startedAt:'2026-01-01T00:00:00Z',events:Array.from({length:45},(_,i)=>({type:'telegram_sent',userId:'a',at:`2026-10-10T12:${String(i).padStart(2,'0')}:00Z`,venues:['gangil']}))} };
    state.analytics.events.push({type:'telegram_failed',userId:'a',at:'2026-10-10T13:00:00Z'}, {type:'telegram_sent',at:'2026-10-10T13:00:00Z'}, {type:'telegram_sent',userId:'b',at:'2026-10-10T13:00:00Z'});
    const first=deliveryHistory(state,'a'); const second=deliveryHistory(state,'a',{offset:first.nextOffset});
    expect(first.summary.total).toBe(45); expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(20);
    expect(first.items[0].message).toBeNull(); expect(first.items[0].items[0].date).toBeUndefined();
    expect(new Set([...first.items,...second.items].map(d=>d.id)).size).toBe(40);
  });
  it('rejects a Telegram ok:false response even with HTTP 200', async () => {
    const { config }=await import('../src/config.js'); const old=config.telegramBotToken; config.telegramBotToken='test';
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({ok:false,description:'private error'})})));
    try { const {sendTelegramMessage}=await import('../src/telegramNotifier.js'); await expect(sendTelegramMessage('test',{chatId:'fake'})).rejects.toThrow('rejected'); }
    finally {config.telegramBotToken=old;vi.unstubAllGlobals();}
  });
});
