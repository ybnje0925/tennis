import { VENUES } from './constants.js';
export const kstDate = at => new Date(new Date(at).getTime() + 9 * 3600000).toISOString().slice(0, 10);
const hour = at => new Date(new Date(at).getTime() + 9 * 3600000).getUTCHours();
export function ensureAnalytics(state, now = new Date().toISOString()) {
  state.analytics ||= { startedAt: now, events: [], visits: {} };
  return state.analytics;
}
export function recordEvent(state, type, data = {}, at = new Date().toISOString()) {
  ensureAnalytics(state, at).events.push({ ...data, type, at });
}
export function recordVisit(state, userId, pageView = false, at = new Date().toISOString()) {
  const analytics = ensureAnalytics(state, at);
  const previous = analytics.visits[userId];
  const newVisit = !previous || Date.parse(at) - Date.parse(previous) >= 30 * 60000;
  analytics.visits[userId] = at;
  recordEvent(state, newVisit ? 'visit' : 'activity', { userId, pageView: Boolean(pageView) }, at);
}
export function buildDashboard(state, days = 7, now = new Date()) {
  const analytics = state.analytics || { startedAt: null, events: [], visits: {} };
  const today = kstDate(now);
  const start = Date.parse(`${today}T00:00:00+09:00`) - (days - 1) * 86400000;
  const events = analytics.events.filter(e => Date.parse(e.at) >= start && Date.parse(e.at) <= +now);
  const count = (list, type) => list.filter(e => e.type === type).length;
  const live = state.watches.filter(w => w.enabled !== false && w.date >= today && state.users.some(u => u.id === w.userId && u.enabled !== false && u.telegramConnected));
  const users = state.users.map(u => {
    const own = events.filter(e => e.userId === u.id);
    const watches = state.watches.filter(w => w.userId === u.id);
    return {
      id: u.id, name: u.name || '이름 없음', enabled: u.enabled !== false, createdAt: u.createdAt,
      telegramConnected: Boolean(u.telegramConnected), inviteUsedAt: state.inviteCodes.find(i => i.usedBy === u.id)?.usedAt || null,
      visits: count(own, 'visit'), visitDays: new Set(own.filter(e => ['visit', 'activity'].includes(e.type)).map(e => kstDate(e.at))).size,
      pageViews: own.filter(e => e.pageView).length, lastVisit: analytics.visits[u.id] || null,
      activeWatches: live.filter(w => w.userId === u.id).length,
      created: count(own, 'watch_created'), deleted: count(own, 'watch_deleted'),
      sent: count(own, 'telegram_sent'), failed: count(own, 'telegram_failed'),
      watches: watches.map(({ id, venues, date, times, enabled }) => ({ id, venues, date, times, enabled })),
      events: own.filter(e => !['visit', 'activity'].includes(e.type)).slice(-100).reverse()
    };
  });
  const venues = Object.values(VENUES).map(v => {
    const watches = live.filter(w => (w.venues || []).includes(v.id));
    return { id: v.id, name: v.name, users: new Set(watches.map(w => w.userId)).size, watches: watches.length,
      sent: events.filter(e => e.type === 'telegram_sent' && (e.venues || []).includes(v.id)).length };
  }).sort((a,b) => b.users - a.users || b.watches - a.watches);
  const hours = Array.from({length:24}, (_, h) => ({ hour:h,
    visits: events.filter(e => e.type === 'visit' && hour(e.at) === h).length,
    created: events.filter(e => e.type === 'watch_created' && hour(e.at) === h).length,
    sent: events.filter(e => e.type === 'telegram_sent' && hour(e.at) === h).length,
    desired: live.reduce((sum,w) => sum + (w.times || []).filter(t => Number(t.slice(0,2)) === h).length, 0)
  }));
  const daily = Array.from({length:days}, (_,i) => {
    const date = kstDate(start + i * 86400000);
    const rows = events.filter(e => kstDate(e.at) === date);
    return { date, visits: count(rows,'visit'), created: count(rows,'watch_created'), sent: count(rows,'telegram_sent'), failed: count(rows,'telegram_failed') };
  });
  return { startedAt: analytics.startedAt, days, generatedAt: now.toISOString(), users, venues, hours, daily,
    summary: { users: users.length, connected: users.filter(u=>u.telegramConnected).length,
      activeUsers: users.filter(u=>u.activeWatches).length, activeWatches: live.length,
      visits: count(events,'visit'), pageViews: events.filter(e=>e.pageView).length,
      sent: count(events,'telegram_sent'), failed: count(events,'telegram_failed'),
      invites: state.inviteCodes.length, usedInvites: state.inviteCodes.filter(i=>i.used).length }
  };
}
