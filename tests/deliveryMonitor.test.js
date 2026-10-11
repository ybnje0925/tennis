import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCheckCycle, resetSchedulerRuntimeForTests } from '../src/monitor.js';
import { deliveryHistory } from '../src/deliveryHistory.js';
let persisted, slots;
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-11T10:00:00Z'));resetSchedulerRuntimeForTests();
 persisted={users:[{id:'u',telegramChatId:'fake',telegramConnected:true,enabled:true}],watches:[{id:'w',userId:'u',venues:['gangil'],date:'2026-10-17',times:['18:00~20:00'],enabled:true}],sentNotifications:{},lastAvailability:{},system:{logs:[],venues:{},providers:{}}};
 slots=[{venue:'gangil',date:'2026-10-17',time:'18:00~20:00',available:true,availableCount:1}];
});
afterEach(()=>vi.useRealTimers());
const runner=notifier=>({source:'manual',notifier,checker:async()=>({gangil:slots}),stateLoader:async()=>structuredClone(persisted),stateSaver:async s=>{persisted=structuredClone(s);}});
it('retries a rejected message under the same id and counts success once',async()=>{
 const send=vi.fn().mockRejectedValueOnce(new Error('rejected')).mockResolvedValue({ok:true,result:{message_id:2,date:1791712800}});
 await runCheckCycle(runner(send));const id=persisted.deliveries[0].id;expect(deliveryHistory(persisted,'u').summary.total).toBe(0);
 await runCheckCycle(runner(send));expect(persisted.deliveries[0].id).toBe(id);expect(persisted.deliveries).toHaveLength(1);expect(deliveryHistory(persisted,'u').summary.total).toBe(1);
 await runCheckCycle(runner(send));expect(send).toHaveBeenCalledTimes(2);
});
it('does not resend a successful message after completion storage fails, including after runtime reset',async()=>{
 const send=vi.fn(async()=>({ok:true,result:{message_id:1}}));const options=runner(send);const save=options.stateSaver;let failed=false;
 options.stateSaver=async s=>{if(!failed && s.deliveries?.some(d=>d.status==='sent')){failed=true;throw new Error('disk failed after send');}await save(s);};
 await runCheckCycle(options);expect(send).toHaveBeenCalledTimes(1);expect(persisted.deliveries[0].status).toBe('pending');
 resetSchedulerRuntimeForTests();await runCheckCycle(runner(send));expect(send).toHaveBeenCalledTimes(1);expect(deliveryHistory(persisted,'u').summary).toMatchObject({total:0,uncertain:1});
});
it('keeps an uncertain network outcome pending and blocks automatic retry',async()=>{
 const error=Object.assign(new Error('response lost'),{deliveryUncertain:true});const send=vi.fn(async()=>{throw error;});
 await runCheckCycle(runner(send));await runCheckCycle(runner(send));expect(send).toHaveBeenCalledTimes(1);expect(persisted.deliveries[0].status).toBe('pending');
});
it('does not contact Telegram when the pre-send journal cannot be persisted',async()=>{
 const send=vi.fn();const options=runner(send);const save=options.stateSaver;
 options.stateSaver=async s=>{if(s.deliveries?.length)throw new Error('disk unavailable');await save(s);};
 await runCheckCycle(options);expect(send).not.toHaveBeenCalled();
});
