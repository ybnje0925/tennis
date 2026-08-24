import cron from "node-cron";
import { config } from "./config.js";
import { PROVIDERS, VENUES } from "./constants.js";
import { CHECK_META, checkAllVenues } from "./checker.js";
import { buildNotificationMessage, sendTelegram } from "./telegram.js";
import { loadState, saveState } from "./storage.js";
import {
  filterOlympicSlotsByWatch,
  isOlympicWatch,
  olympicKeyFor
} from "./providers/olympicProvider.js";

export function keyFor(item) {
  if (item.provider === "olympic") return olympicKeyFor(item);
  return `${item.venue}|${item.date}|${item.time}`;
}

function availabilityValue(value) {
  if (typeof value === "boolean") return value;
  return Boolean(value?.available);
}

export function getActiveWatches(state) {
  const enabledUsers = new Set(
    (state.users || [])
      .filter((user) => user.enabled !== false && user.telegramConnected && user.telegramChatId)
      .map((user) => user.id)
  );
  return state.watches.filter((watch) => watch.enabled === true && watch.userId && enabledUsers.has(watch.userId));
}

export function groupActiveWatchesByVenue(watches) {
  const grouped = Object.fromEntries(Object.keys(VENUES).map((venueId) => [venueId, []]));

  for (const watch of watches) {
    for (const venueId of watch.venues || []) {
      if (!grouped[venueId]) grouped[venueId] = [];
      grouped[venueId].push(watch);
    }
  }

  return grouped;
}

export function buildVenueDateTargets(grouped) {
  return Object.fromEntries(
    Object.entries(grouped)
      .map(([venueId, watches]) => [venueId, Array.from(new Set(watches.map((watch) => watch.date))).sort()])
      .filter(([, dates]) => dates.length > 0)
  );
}

export function findNotifications(state, reservations) {
  const olympicSlots = reservations.filter((item) => item.provider === "olympic");
  const byKey = new Map(reservations.map((item) => [keyFor(item), item]));
  const notifications = [];

  for (const watch of getActiveWatches(state)) {
    if (isOlympicWatch(watch)) {
      const matches = filterOlympicSlotsByWatch(olympicSlots, normalizeOlympicWatch(watch));
      const currentKeys = new Set(matches.map(keyFor));
      for (const sentKey of Object.keys(state.sentNotifications || {})) {
        if (!sentKey.startsWith(`${watch.id}|`)) continue;
        const key = sentKey.slice(`${watch.id}|`.length);
        if (key.startsWith("olympic|") && !currentKeys.has(key)) {
          state.lastAvailability[key] = { available: false };
        }
      }

      for (const item of matches) {
        const key = keyFor(item);
        const previous = availabilityValue(state.lastAvailability[key]);
        const wasUnavailable = previous !== true;
        const alreadySent = state.sentNotifications[`${watch.id}|${key}`];
        if (wasUnavailable || !alreadySent) notifications.push({ watch, item, key });
      }
      continue;
    }

    for (const venue of watch.venues) {
      for (const time of watch.times) {
        const key = `${venue}|${watch.date}|${time}`;
        const item = byKey.get(key);
        if (!item || !item.available) continue;

        const previous = availabilityValue(state.lastAvailability[key]);
        const wasUnavailable = previous !== true;
        const alreadySent = state.sentNotifications[`${watch.id}|${key}`];
        if (wasUnavailable || !alreadySent) notifications.push({ watch, item, key });
      }
    }
  }

  return notifications;
}

export function addLog(state, message, date = new Date()) {
  const time = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul"
  }).format(date);
  state.system.logs.push(`[${time}] ${message}`);
  state.system.logs = state.system.logs.slice(-30);
}

export function activeProviderVenueIds(activeVenueIds) {
  const result = new Map();
  for (const venueId of activeVenueIds) {
    const providerId = VENUES[venueId]?.provider;
    if (!providerId) continue;
    if (!result.has(providerId)) result.set(providerId, []);
    result.get(providerId).push(venueId);
  }
  return result;
}

export function providerNextRunAt(lastCheckedAt, pollingMinutes) {
  if (!lastCheckedAt) return null;
  return new Date(Date.parse(lastCheckedAt) + pollingMinutes * 60_000).toISOString();
}

export function isProviderDue(providerState, now = new Date()) {
  if (!providerState?.lastCheckedAt) return true;
  const pollingMinutes = providerState.pollingMinutes || PROVIDERS[providerState.id]?.pollingMinutes || 5;
  return Date.parse(providerState.lastCheckedAt) + pollingMinutes * 60_000 <= now.getTime();
}

export function filterWatchesToVenueIds(watches, venueIds) {
  const allowed = new Set(venueIds);
  return watches
    .map((watch) => ({
      ...watch,
      venues: (watch.venues || []).filter((venueId) => allowed.has(venueId))
    }))
    .filter((watch) => watch.venues.length > 0);
}

export function syncProviderSchedule(state, activeProviderIds, now = new Date()) {
  state.system.providers ||= {};
  const active = new Set(activeProviderIds);

  for (const providerId of Object.keys(PROVIDERS)) {
    const previous = state.system.providers[providerId] || {};
    const pollingMinutes = PROVIDERS[providerId].pollingMinutes;
    const lastCheckedAt = previous.lastCheckedAt || null;
    state.system.providers[providerId] = {
      id: providerId,
      pollingMinutes,
      active: active.has(providerId),
      lastCheckedAt,
      nextCheckAt: active.has(providerId) ? providerNextRunAt(lastCheckedAt, pollingMinutes) || now.toISOString() : null
    };
  }

  state.system.lastCheckedAt = latestProviderTime(state.system.providers, "lastCheckedAt");
  state.system.nextCheckAt = earliestActiveProviderTime(state.system.providers);
}

function latestProviderTime(providers, key) {
  const values = Object.values(providers || {}).map((item) => item[key]).filter(Boolean).sort();
  return values.at(-1) || null;
}

function earliestActiveProviderTime(providers) {
  const values = Object.values(providers || {})
    .filter((item) => item.active && item.nextCheckAt)
    .map((item) => item.nextCheckAt)
    .sort();
  return values[0] || null;
}

export function nextRunAt(date = new Date(), minuteStep = config.checkIntervalMinutes) {
  const next = new Date(date);
  const minutes = next.getMinutes();
  const addMinutes = minuteStep - (minutes % minuteStep || minuteStep);
  next.setMinutes(minutes + addMinutes, 0, 0);
  if (next <= date) next.setMinutes(next.getMinutes() + minuteStep, 0, 0);
  return next.toISOString();
}

export async function runCheckCycle({
  checker = checkAllVenues,
  notifier = sendTelegram,
  stateLoader = loadState,
  stateSaver = saveState,
  source = "scheduler"
} = {}) {
  const state = await stateLoader();
  state.system.providers ||= {};
  const usersById = new Map((state.users || []).map((user) => [user.id, user]));
  const activeWatches = getActiveWatches(state);
  const grouped = groupActiveWatchesByVenue(activeWatches);
  const venueDates = buildVenueDateTargets(grouped);
  const activeVenueIds = Object.keys(venueDates).filter((venueId) => (
    VENUES[venueId]?.provider !== "olympic" || config.enableOlympicProvider
  ));
  const activeProviders = activeProviderVenueIds(activeVenueIds);
  syncProviderSchedule(state, Array.from(activeProviders.keys()));

  if (activeWatches.length === 0 || activeVenueIds.length === 0) {
    const checkedAt = new Date().toISOString();
    if (source !== "scheduler") {
      state.system.lastCheckedAt = checkedAt;
      addLog(state, "No active alerts. Skipping all reservation checks.");
    }
    await stateSaver(state);
    return { checkedAt, reservations: [], notifications: [], errors: [], skipped: true };
  }

  let targetVenueIds = activeVenueIds;
  let targetWatches = activeWatches;
  if (source === "scheduler") {
    targetVenueIds = activeVenueIds.filter((venueId) => {
      const providerId = VENUES[venueId]?.provider;
      return isProviderDue(state.system.providers[providerId]);
    });
    targetWatches = filterWatchesToVenueIds(activeWatches, targetVenueIds);
    if (targetVenueIds.length === 0 || targetWatches.length === 0) {
      syncProviderSchedule(state, Array.from(activeProviders.keys()));
      await stateSaver(state);
      return { checkedAt: new Date().toISOString(), reservations: [], notifications: [], errors: [], skipped: true, notDue: true };
    }
  }

  let checked;
  const errors = [];
  try {
    const checkedAt = new Date().toISOString();
    await stateSaver(state);
    checked = await checker({ watches: targetWatches, source });
  } catch (error) {
    const checkedAt = new Date().toISOString();
    checked = {};
    Object.defineProperty(checked, CHECK_META, {
      value: { errors: targetVenueIds.map((venueId) => ({ provider: VENUES[venueId]?.provider, venueId, message: error.message })) },
      enumerable: false,
      configurable: true
    });
    updateCheckedProviderSchedule(state, targetVenueIds, checkedAt);
    syncProviderSchedule(state, Array.from(activeProviders.keys()));
    addLog(state, buildCycleSummary({ checked, activeVenueIds: targetVenueIds, vacancyCount: 0, alertCount: 0 }));
    await stateSaver(state);
    return { checkedAt, reservations: [], notifications: [], errors: [error.message] };
  }

  const reservations = Object.values(checked).flat();
  const notifications = findNotifications(state, reservations);
  const vacancyCount = countMatchingAvailableItems(state, reservations);

  const checkedAt = new Date().toISOString();
  for (const venueId of Object.keys(checked)) {
    const count = checked[venueId]?.length ?? 0;
    state.system.venues[venueId] = {
      ok: count > 0,
      checkedAt,
      count
    };
  }

  let alertCount = 0;
  for (const notification of notifications) {
    try {
      const user = usersById.get(notification.watch.userId);
      if (!user?.telegramChatId || user.enabled === false) continue;
      await notifier(buildNotificationMessage(notification.item), user.telegramChatId);
      state.sentNotifications[`${notification.watch.id}|${notification.key}`] = checkedAt;
      alertCount += 1;
    } catch (error) {
      errors.push(error.message);
      console.error(`Telegram 알림 발송 실패: ${error.message}`);
    }
  }
  addLog(state, buildCycleSummary({ checked, activeVenueIds: targetVenueIds, vacancyCount, alertCount }));

  for (const item of reservations) {
    state.lastAvailability[keyFor(item)] = {
      provider: item.provider,
      venue: item.venue,
      courtType: item.courtType,
      courtNo: item.courtNo,
      date: item.date,
      time: item.time,
      startTime: item.startTime,
      endTime: item.endTime,
      available: item.available,
      availableCount: item.availableCount,
      checkedAt
    };
  }
  for (const notification of notifications) {
    state.lastAvailability[notification.key] = {
      provider: notification.item.provider,
      venue: notification.item.venue,
      courtType: notification.item.courtType,
      courtNo: notification.item.courtNo,
      date: notification.item.date,
      time: notification.item.time,
      startTime: notification.item.startTime,
      endTime: notification.item.endTime,
      available: true,
      checkedAt
    };
  }
  updateCheckedProviderSchedule(state, targetVenueIds, checkedAt);
  syncProviderSchedule(state, Array.from(activeProviders.keys()));
  await stateSaver(state);
  return { checkedAt, reservations, notifications, errors };
}

function updateCheckedProviderSchedule(state, venueIds, checkedAt) {
  state.system.providers ||= {};
  for (const providerId of activeProviderVenueIds(venueIds).keys()) {
    state.system.providers[providerId] = {
      ...(state.system.providers[providerId] || {}),
      id: providerId,
      pollingMinutes: PROVIDERS[providerId]?.pollingMinutes || 5,
      lastCheckedAt: checkedAt
    };
  }
}

export function buildCycleSummary({ checked, activeVenueIds, vacancyCount, alertCount }) {
  const parts = ["조회완료"];
  const activeProviders = providerTargets(activeVenueIds);
  const checkErrors = checked?.[CHECK_META]?.errors || [];

  for (const providerId of ["gangdong", "songpa", "olympic"]) {
    if (!activeProviders.has(providerId)) continue;
    parts.push(providerSummary(providerId, activeProviders.get(providerId), checked, checkErrors));
  }

  const tail = [`빈자리 ${vacancyCount}건`];
  if (vacancyCount > 0) tail.push(`알림 ${alertCount}건`);
  parts.push(tail.join(" → "));
  return parts.join(" | ");
}

function providerTargets(activeVenueIds) {
  const targets = new Map();
  for (const venueId of activeVenueIds) {
    const providerId = VENUES[venueId]?.provider;
    if (!providerId) continue;
    if (!targets.has(providerId)) targets.set(providerId, []);
    targets.get(providerId).push(venueId);
  }
  return targets;
}

function providerSummary(providerId, venueIds, checked, errors) {
  const providerErrors = errors.filter((error) => error.provider === providerId);
  if (providerId === "olympic") {
    if (providerErrors.length > 0 || !Object.prototype.hasOwnProperty.call(checked, "olympic")) {
      return `올림픽✕(${shortReason(providerErrors[0]?.message)})`;
    }
    return "올림픽✓";
  }

  const label = providerId === "gangdong" ? "강동" : "송파";
  const failedVenueIds = new Set(providerErrors.map((error) => error.venueId).filter(Boolean));
  const successCount = venueIds.filter((venueId) => (
    Object.prototype.hasOwnProperty.call(checked, venueId) && !failedVenueIds.has(venueId)
  )).length;
  const mark = successCount === venueIds.length ? "✓" : successCount > 0 ? "△" : `✕(${shortReason(providerErrors[0]?.message)})`;
  return `${label} ${successCount}/${venueIds.length}${mark}`;
}

function shortReason(message = "조회 실패") {
  if (/date selector|날짜/.test(message)) return "날짜조회 실패";
  if (/login|로그인/i.test(message)) return "로그인 실패";
  if (/중복|duplicate/i.test(message)) return "중복접속";
  return "조회 실패";
}

export function countMatchingAvailableItems(state, reservations) {
  const matches = new Set();
  const olympicSlots = reservations.filter((item) => item.provider === "olympic");
  const byKey = new Map(reservations.map((item) => [keyFor(item), item]));

  for (const watch of getActiveWatches(state)) {
    if (isOlympicWatch(watch)) {
      for (const item of filterOlympicSlotsByWatch(olympicSlots, normalizeOlympicWatch(watch))) {
        matches.add(keyFor(item));
      }
      continue;
    }

    for (const venue of watch.venues || []) {
      for (const time of watch.times || []) {
        const key = `${venue}|${watch.date}|${time}`;
        const item = byKey.get(key);
        if (item?.available) matches.add(key);
      }
    }
  }

  return matches.size;
}

function normalizeOlympicWatch(watch) {
  return {
    ...watch,
    provider: "olympic",
    venue: "olympic",
    times: watch.times || [],
  };
}

export function startScheduler() {
  const expression = "* * * * *";
  loadState()
    .then((state) => {
      const activeWatches = getActiveWatches(state);
      const grouped = groupActiveWatchesByVenue(activeWatches);
      const activeVenueIds = Object.keys(buildVenueDateTargets(grouped)).filter((venueId) => (
        VENUES[venueId]?.provider !== "olympic" || config.enableOlympicProvider
      ));
      syncProviderSchedule(state, Array.from(activeProviderVenueIds(activeVenueIds).keys()));
      return saveState(state);
    })
    .catch((error) => console.error(`Scheduler state update failed: ${error.message}`));
  const task = cron.schedule(expression, () => {
    runCheckCycle().catch((error) => {
      console.error(`Check cycle failed: ${error.message}`);
    });
  });
  console.log(`Scheduler started: provider polling due check every 1 minute.`);
  console.log(`Polling | 강동 ${PROVIDERS.gangdong.pollingMinutes}분 | 송파 ${PROVIDERS.songpa.pollingMinutes}분 | 올림픽 ${PROVIDERS.olympic.pollingMinutes}분`);
  return task;
}
