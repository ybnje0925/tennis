import crypto from 'node:crypto';
import { kstDate } from './analytics.js';
import { VENUES } from './constants.js';

// A pending journal survives a restart. Its outcome is uncertain: never resend it automatically.
export function beginDelivery(state, group, message, at = new Date().toISOString()) {
  state.deliveries ||= [];
  state.deliveryStartedAt ||= at;
  const keys = group.notifications.map(n => `${n.watch.id}|${n.key}`).sort();
  if (state.deliveries.some(d => d.status === 'pending' && d.keys.some(k => keys.includes(k)))) return null;
  const retry = state.deliveries.find(d => d.status === 'failed' && d.userId === group.watch.userId && JSON.stringify(d.keys) === JSON.stringify(keys));
  const row = retry || { id: crypto.randomUUID(), userId: group.watch.userId, watchId: group.watch.id, keys, attempts: [], createdAt: at };
  row.status = 'pending'; row.at = at; row.message = message;
  row.items = group.notifications.map(({ item }) => ({ venue: item.venue, venueName: item.venueName || VENUES[item.venue]?.name || item.venue, date: item.date, time: item.time || `${item.startTime}~${item.endTime}`, courtNo: item.courtNo || null }));
  row.attempts.push({ at, status: 'pending' });
  if (!retry) state.deliveries.push(row);
  return row.id;
}
export function finishDelivery(state, id, status, result, at = new Date().toISOString()) {
  const row = state.deliveries?.find(d => d.id === id);
  if (!row) throw new Error('Missing delivery journal');
  row.status = status; row.at = at;
  Object.assign(row.attempts.at(-1), { status, at });
  if (status === 'sent') {
    row.sentAt = at;
    row.telegramMessageId = result?.result?.message_id ?? null;
  }
}
export function deliveryHistory(state, userId, query = {}, now = new Date()) {
  const rows = (state.deliveries || []).filter(d => d.userId === userId && ['sent', 'failed'].includes(d.status));
  // Old failures cannot be linked to a retry. Only attributable success events are safe to count.
  const legacy = (state.analytics?.events || []).flatMap((e, i) => e.type === 'telegram_sent' && e.userId === userId && !e.deliveryId ? [{ id: `legacy-${i}`, status: 'sent', at: e.at, items: (e.venues || []).map(venue => ({ venue, venueName: VENUES[venue]?.name || venue })), message: null, legacy: true, attempts: [] }] : []);
  const all = [...rows, ...legacy].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  const success = all.filter(d => d.status === 'sent');
  const today = kstDate(now);
  const filtered = all.filter(d => (query.period !== 'today' || kstDate(d.at) === today) && (!['sent', 'failed'].includes(query.status) || d.status === query.status));
  const limit = 20;
  const offset = Math.max(0, Math.min(Number.parseInt(query.offset, 10) || 0, filtered.length));
  return {
    summary: { total: success.length, today: success.filter(d => kstDate(d.at) === today).length, latestAt: success[0]?.at || null, startedAt: state.analytics?.startedAt || state.deliveryStartedAt || null, detailedStartedAt: state.deliveryStartedAt || null, uncertain: (state.deliveries || []).filter(d => d.userId === userId && d.status === 'pending').length },
    total: filtered.length, nextOffset: offset + limit < filtered.length ? offset + limit : null,
    items: (query.summary === '1' ? [] : filtered.slice(offset, offset + limit)).map(d => ({ id: d.id, at: d.at, status: d.status, items: d.items, message: d.message, legacy: Boolean(d.legacy), attemptCount: (d.attempts || []).length, attempts: (d.attempts || []).slice(-10).map(a => ({ at: a.at, status: a.status })) }))
  };
}
