import cron from "node-cron";
import { config } from "./config.js";
import { PROVIDERS, VENUES } from "./constants.js";
import { CHECK_META, checkAllVenues } from "./checker.js";
import { buildNotificationMessage, sendTelegram } from "./telegram.js";
import { loadState, saveState, updateState } from "./storage.js";
import {
  filterOlympicSlotsByWatch,
  isOlympicWatch,
  olympicKeyFor
} from "./providers/olympicProvider.js";
import { normalizeDate, normalizeTimeSlot, reservationKey } from "./normalization.js";
import { classifyError } from "./diagnostics.js";

const inFlightProviders = new Set();
const providerRuntimeState = new Map();
let schedulerTask = null;
const SERVICE_TIME_ZONE = "Asia/Seoul";
export const SCHEDULER_VERSION = "provider-pending-v2";

export function keyFor(item) {
  if (item.provider === "olympic") return olympicKeyFor(item);
  return reservationKey(item);
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
      .map(([venueId, watches]) => [
        venueId,
        Array.from(new Set(watches.map((watch) => normalizeDate(watch.date)).filter(Boolean))).sort()
      ])
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
        const key = reservationKey({ venue, date: watch.date, time });
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
    timeZone: SERVICE_TIME_ZONE
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

export function fixedSlotKey(date = new Date()) {
  return kstSlotKey(date);
}

export function providerPollingMinutes(providerId) {
  return PROVIDERS[providerId]?.pollingMinutes || 5;
}

export function isProviderDue(providerState, now = new Date()) {
  const pollingMinutes = providerPollingMinutes(providerState.id);
  return kstParts(now).minute % pollingMinutes === 0;
}

export function nextFixedSlotAt(date = new Date(), pollingMinutes = 5) {
  const next = new Date(date);
  const { minute } = kstParts(next);
  let addMinutes = (pollingMinutes - (minute % pollingMinutes)) % pollingMinutes;
  if (addMinutes === 0) addMinutes = pollingMinutes;
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + addMinutes);
  return next.toISOString();
}

export function isProviderWithinMonitoringHours(providerId, date = new Date()) {
  const hours = PROVIDERS[providerId]?.monitoringHours;
  if (!hours) return true;
  const current = kstMinuteOfDay(date);
  const start = clockToMinutes(hours.start);
  const end = clockToMinutes(hours.end);
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function nextProviderMonitoringStartAt(providerId, date = new Date()) {
  const hours = PROVIDERS[providerId]?.monitoringHours;
  if (!hours || isProviderWithinMonitoringHours(providerId, date)) return null;
  const start = clockToMinutes(hours.start);
  return kstDateTimeToInstant({ ...kstParts(date), minuteOfDay: start }, date);
}

function clockToMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

function kstMinuteOfDay(date) {
  const parts = kstParts(date);
  return parts.hour * 60 + parts.minute;
}

function kstParts(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SERVICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function kstSlotKey(date) {
  const parts = kstParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function kstDateTimeToInstant({ year, month, day, minuteOfDay }, baseDate) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  let candidate = new Date(Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0));
  if (candidate <= baseDate) {
    candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return candidate.toISOString();
}

function outsideMonitoringHoursLabel(providerId) {
  const hours = PROVIDERS[providerId]?.monitoringHours;
  if (!hours) return "";
  const start = hours.start === "24:00" ? "00:00" : hours.start;
  const end = hours.end === "24:00" ? "00:00" : hours.end;
  return `${end}~${start}`;
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
    const runtime = providerRuntime(providerId);
    const pollingMinutes = providerPollingMinutes(providerId);
    const lastCheckedAt = previous.lastCheckedAt || null;
    const withinMonitoringHours = isProviderWithinMonitoringHours(providerId, now);
    const pending = Boolean(runtime.pending);
    const status = !active.has(providerId)
      ? "idle"
      : !withinMonitoringHours
        ? "outside-hours"
        : runtime.inFlight
          ? "running"
          : pending
            ? "pending"
            : previous.status === "error"
              ? "error"
              : "idle";
    state.system.providers[providerId] = {
      id: providerId,
      pollingMinutes,
      active: active.has(providerId),
      status,
      lastCheckedAt,
      lastAttemptAt: previous.lastAttemptAt || null,
      lastSuccessfulCheckAt: previous.lastSuccessfulCheckAt || lastCheckedAt || null,
      lastStartedAt: previous.lastStartedAt || null,
      lastFinishedAt: previous.lastFinishedAt || null,
      lastDurationMs: previous.lastDurationMs || null,
      lastProcessedSlotAt: previous.lastProcessedSlotAt || null,
      pending,
      lastError: previous.lastError || null,
      lastErrorAt: previous.lastErrorAt || null,
      monitoringHours: PROVIDERS[providerId]?.monitoringHours || null,
      monitoringStatus: withinMonitoringHours ? "active" : "outside-hours",
      nextCheckAt: active.has(providerId)
        ? (withinMonitoringHours ? nextFixedSlotAt(now, pollingMinutes) : nextProviderMonitoringStartAt(providerId, now))
        : null
    };
  }

  const commonLast = commonActiveProviderTime(state.system.providers, "lastCheckedAt");
  const commonNext = commonActiveProviderTime(state.system.providers, "nextCheckAt");
  state.system.lastCheckedAt = commonLast;
  state.system.nextCheckAt = commonNext;
  state.system.lastRunAt ||= commonLast;
  state.system.nextRunAt = nextFixedSlotAt(now, schedulerIntervalMinutes(activeProviderIds));
}

function commonActiveProviderTime(providers, key) {
  const values = Object.values(providers || {})
    .filter((item) => item.active && item[key])
    .map((item) => item[key])
    .sort();
  if (values.length === 0) return null;
  return values.every((value) => value === values[0]) ? values[0] : null;
}

export function nextRunAt(date = new Date(), minuteStep = 5) {
  return nextFixedSlotAt(date, minuteStep);
}

function schedulerIntervalMinutes(providerIds = Object.keys(PROVIDERS)) {
  const values = Array.from(providerIds).map(providerPollingMinutes).filter(Number.isFinite);
  if (values.length === 0) return 5;
  return Math.min(...values);
}

function createStateUpdater(stateLoader, stateSaver, stateUpdater) {
  if (stateUpdater) return stateUpdater;
  if (stateLoader === loadState && stateSaver === saveState) return updateState;
  return async (mutator) => {
    const latest = await stateLoader();
    const result = await mutator(latest);
    await stateSaver(latest);
    return result === undefined ? latest : result;
  };
}

function activeContextFor(state) {
  const activeWatches = getActiveWatches(state);
  const grouped = groupActiveWatchesByVenue(activeWatches);
  const venueDates = buildVenueDateTargets(grouped);
  const activeVenueIds = Object.keys(venueDates).filter((venueId) => (
    VENUES[venueId]?.provider !== "olympic" || config.enableOlympicProvider
  ));
  const activeProviders = activeProviderVenueIds(activeVenueIds);
  return { activeWatches, grouped, venueDates, activeVenueIds, activeProviders };
}

function mergeProviderStart(state, providerIds, { now, source, slotKey, activeProviderIds }) {
  state.system.providers ||= {};
  syncProviderSchedule(state, activeProviderIds, now);
  for (const providerId of providerIds) {
    const runtime = providerRuntime(providerId);
    runtime.inFlight = true;
    runtime.startedAt ||= new Date();
    state.system.providers[providerId] = {
      ...(state.system.providers[providerId] || {}),
      id: providerId,
      active: true,
      status: "running",
      pending: false,
      lastStartedAt: runtime.startedAt.toISOString(),
      lastError: null,
      lastProcessedSlotAt: slotKey
    };
    addLog(state, `${providerLabel(providerId)} ${source === "scheduler-pending" ? "지연" : "정규"} 조회 START`, now);
  }
}

function mergeProviderFailure(state, {
  providerIds,
  targetVenueIds,
  checked,
  checkedAt,
  now,
  activeVenueIds,
  activeProviderIds,
  skippedProviders,
  error
}) {
  for (const providerId of providerIds) finishProviderRuntime(state, providerId, checkedAt, error);
  updateAttemptedProviderSchedule(state, targetVenueIds, checkedAt);
  syncProviderSchedule(state, activeProviderIds, now);
  addLog(state, buildCycleSummary({
    checked,
    activeVenueIds: summaryVenueIds(targetVenueIds, activeVenueIds, skippedProviders),
    skippedProviders,
    vacancyCount: 0,
    alertCount: 0
  }), now);
  finishRunState(state, now, activeVenueIds, checked, skippedProviders, checkedAt);
}

function mergeProviderSuccess(state, {
  providerIds,
  checked,
  reservations,
  checkedAt,
  now,
  targetVenueIds,
  activeVenueIds,
  activeProviderIds,
  skippedProviders,
  alertCount,
  checkErrors = []
}) {
  for (const providerId of providerIds) {
    const stats = providerCheckStats(providerId, targetVenueIds, checked, checkErrors);
    finishProviderRuntime(state, providerId, checkedAt, stats.failed > 0 ? providerErrorMessage(checkErrors, providerId) : null, stats);
  }
  const vacancyCount = countMatchingAvailableItems(state, reservations);

  for (const venueId of Object.keys(checked)) {
    if (venueId === CHECK_META) continue;
    const count = checked[venueId]?.length ?? 0;
    state.system.venues[venueId] = { ok: count > 0, checkedAt, count };
  }

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
  updateAttemptedProviderSchedule(state, targetVenueIds, checkedAt);
  updateCheckedProviderSchedule(state, successfulVenueIds(targetVenueIds, checked), checkedAt);
  syncProviderSchedule(state, activeProviderIds, now);
  addLog(state, buildCycleSummary({
    checked,
    activeVenueIds: summaryVenueIds(targetVenueIds, activeVenueIds, skippedProviders),
    skippedProviders,
    vacancyCount,
    alertCount
  }), now);
  finishRunState(state, now, activeVenueIds, checked, skippedProviders, checkedAt);
}

export async function runCheckCycle({
  checker = checkAllVenues,
  notifier = sendTelegram,
  stateLoader = loadState,
  stateSaver = saveState,
  stateUpdater = null,
  source = "scheduler",
  now = new Date(),
  targetProviderIds = null,
  forceDue = false
} = {}) {
  const mutateState = createStateUpdater(stateLoader, stateSaver, stateUpdater);
  const state = await stateLoader();
  const runStartedAt = now.toISOString();
  state.system.providers ||= {};
  const { activeWatches, activeVenueIds, activeProviders } = activeContextFor(state);
  const activeProviderIds = Array.from(activeProviders.keys());
  const runIntervalMinutes = schedulerIntervalMinutes(activeProviders.keys());
  syncProviderSchedule(state, activeProviderIds, now);

  if (activeWatches.length === 0 || activeVenueIds.length === 0) {
    const checkedAt = new Date().toISOString();
    await mutateState((latest) => {
      const latestContext = activeContextFor(latest);
      syncProviderSchedule(latest, Array.from(latestContext.activeProviders.keys()), now);
      latest.system.lastRun = {
        runStartedAt,
        runFinishedAt: checkedAt,
        nextRunAt: nextFixedSlotAt(now, runIntervalMinutes),
        facilities: {}
      };
      if (source !== "scheduler") {
        latest.system.lastCheckedAt = checkedAt;
        addLog(latest, "No active alerts. Skipping all reservation checks.");
      }
    });
    return { checkedAt, reservations: [], notifications: [], errors: [], skipped: true };
  }

  const requestedProviderIds = targetProviderIds
    ? new Set(targetProviderIds.filter((providerId) => activeProviders.has(providerId)))
    : null;
  let targetVenueIds = requestedProviderIds
    ? activeVenueIds.filter((venueId) => requestedProviderIds.has(VENUES[venueId]?.provider))
    : activeVenueIds;
  let targetWatches = activeWatches;
  let selectedProviderIds = requestedProviderIds ? Array.from(requestedProviderIds) : Array.from(activeProviders.keys());
  const skippedProviders = selectedProviderIds
    .filter((providerId) => !isProviderWithinMonitoringHours(providerId, now))
    .map((provider) => ({ provider, reason: "운영시간 외" }));
  const skippedProviderIds = new Set(skippedProviders.map((item) => item.provider));
  const slotKey = fixedSlotKey(now);
  const blockedProviderIds = [];
  if (source === "scheduler" || source === "scheduler-pending") {
    const dueProviderIds = new Set(selectedProviderIds.filter((providerId) => {
      const providerState = state.system.providers[providerId];
      if (!forceDue && !isProviderDue(providerState, now)) return false;
      if (!forceDue && providerState.lastProcessedSlotAt === slotKey) return false;
      if (skippedProviderIds.has(providerId)) return false;
      if (inFlightProviders.has(providerId)) {
        markProviderPending(state, providerId, slotKey, now);
        blockedProviderIds.push(providerId);
        return false;
      }
      return true;
    }));
    targetVenueIds = activeVenueIds.filter((venueId) => {
      const providerId = VENUES[venueId]?.provider;
      return dueProviderIds.has(providerId);
    });
    targetWatches = filterWatchesToVenueIds(activeWatches, targetVenueIds);
    selectedProviderIds = Array.from(dueProviderIds);
    if (targetVenueIds.length === 0 || targetWatches.length === 0) {
      await mutateState((latest) => {
        const latestContext = activeContextFor(latest);
        syncProviderSchedule(latest, Array.from(latestContext.activeProviders.keys()), now);
        for (const providerId of blockedProviderIds) {
          if (inFlightProviders.has(providerId)) {
            markProviderPending(latest, providerId, slotKey, now);
          }
        }
        if (skippedProviders.length > 0) {
          addSkipLogs(latest, skippedProviders, now);
          addLog(latest, buildCycleSummary({
            checked: {},
            activeVenueIds,
            skippedProviders,
            vacancyCount: 0,
            alertCount: 0
          }), now);
          finishRunState(latest, now, activeVenueIds, {}, skippedProviders);
        }
      });
      return { checkedAt: new Date().toISOString(), reservations: [], notifications: [], errors: [], skipped: true, notDue: true };
    }

    for (const providerId of selectedProviderIds) {
      inFlightProviders.add(providerId);
      const runtime = providerRuntime(providerId);
      runtime.inFlight = true;
      runtime.startedAt = new Date();
    }
    try {
      await mutateState((latest) => {
        const latestContext = activeContextFor(latest);
        mergeProviderStart(latest, selectedProviderIds, {
          now,
          source,
          slotKey,
          activeProviderIds: Array.from(latestContext.activeProviders.keys())
        });
        latest.system.lastRun = {
          runStartedAt,
          runFinishedAt: null,
          nextRunAt: nextFixedSlotAt(now, runIntervalMinutes),
          facilities: {}
        };
      });
    } catch (error) {
      releaseProviderRuntimeLocks(selectedProviderIds);
      throw error;
    }
  } else if (skippedProviderIds.size > 0) {
    targetVenueIds = activeVenueIds.filter((venueId) => !skippedProviderIds.has(VENUES[venueId]?.provider));
    targetWatches = filterWatchesToVenueIds(activeWatches, targetVenueIds);
    selectedProviderIds = selectedProviderIds.filter((providerId) => !skippedProviderIds.has(providerId));
    if (targetVenueIds.length === 0 || targetWatches.length === 0) {
      await mutateState((latest) => {
        const latestContext = activeContextFor(latest);
        syncProviderSchedule(latest, Array.from(latestContext.activeProviders.keys()), now);
        addSkipLogs(latest, skippedProviders, now);
        addLog(latest, buildCycleSummary({
          checked: {},
          activeVenueIds,
          skippedProviders,
          vacancyCount: 0,
          alertCount: 0
        }), now);
        finishRunState(latest, now, activeVenueIds, {}, skippedProviders);
      });
      return { checkedAt: new Date().toISOString(), reservations: [], notifications: [], errors: [], skipped: true };
    }
  }

  let checked;
  const errors = [];
  try {
    checked = await checker({ watches: targetWatches, source });
  } catch (error) {
    const checkedAt = new Date().toISOString();
    checked = {};
    Object.defineProperty(checked, CHECK_META, {
      value: {
        errors: targetVenueIds.map((venueId) => classifyError(error, {
          provider: VENUES[venueId]?.provider,
          venueId,
          venueName: VENUES[venueId]?.name,
          targetDate: targetWatches.find((watch) => (watch.venues || []).includes(venueId))?.date || null
        }))
      },
      enumerable: false,
      configurable: true
    });
    const pendingProviderIds = selectedProviderIds.filter((providerId) => providerRuntime(providerId).pending);
    try {
      await mutateState((latest) => {
        const latestContext = activeContextFor(latest);
        mergeProviderFailure(latest, {
          providerIds: selectedProviderIds,
          targetVenueIds,
          checked,
          checkedAt,
          now,
          activeVenueIds,
          activeProviderIds: Array.from(latestContext.activeProviders.keys()),
          skippedProviders,
          error
        });
      });
    } catch (stateError) {
      releaseProviderRuntimeLocks(selectedProviderIds);
      throw stateError;
    }
    runPendingProviderChecks(pendingProviderIds, { checker, notifier, stateLoader, stateSaver });
    return { checkedAt, reservations: [], notifications: [], errors: [error.message] };
  }

  const reservations = Object.values(checked).flat();
  const checkedAt = new Date().toISOString();
  const pendingProviderIds = selectedProviderIds.filter((providerId) => providerRuntime(providerId).pending);
  const checkErrors = checked?.[CHECK_META]?.errors || [];
  const notificationVenueIds = new Set(successfulVenueIds(targetVenueIds, checked));
  let notificationPlan;
  try {
    notificationPlan = await mutateState((latest) => {
      const notifications = findNotifications({
        ...latest,
        watches: (latest.watches || [])
          .map((watch) => ({
            ...watch,
            venues: (watch.venues || []).filter((venueId) => notificationVenueIds.has(venueId))
          }))
          .filter((watch) => watch.venues.length > 0)
      }, reservations);
      return {
        notifications,
        usersById: Object.fromEntries((latest.users || []).map((user) => [user.id, user]))
      };
    });
  } catch (error) {
    releaseProviderRuntimeLocks(selectedProviderIds);
    throw error;
  }

  let alertCount = 0;
  for (const notification of notificationPlan.notifications) {
    try {
      const user = notificationPlan.usersById[notification.watch.userId];
      if (!user?.telegramChatId || user.enabled === false) continue;
      await notifier(buildNotificationMessage(notification.item), user.telegramChatId);
      await mutateState((latest) => {
        latest.sentNotifications[`${notification.watch.id}|${notification.key}`] = checkedAt;
        latest.lastAvailability[notification.key] = {
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
      });
      alertCount += 1;
    } catch (error) {
      errors.push(error.message);
      console.error(`Telegram 알림 발송 실패: ${error.message}`);
    }
  }

  try {
    await mutateState((latest) => {
      const latestContext = activeContextFor(latest);
      mergeProviderSuccess(latest, {
        providerIds: selectedProviderIds,
        checked,
        reservations,
        checkedAt,
        now,
        targetVenueIds,
        activeVenueIds,
        activeProviderIds: Array.from(latestContext.activeProviders.keys()),
        skippedProviders,
        alertCount,
        checkErrors
      });
    });
  } catch (error) {
    releaseProviderRuntimeLocks(selectedProviderIds);
    throw error;
  }

  runPendingProviderChecks(pendingProviderIds, { checker, notifier, stateLoader, stateSaver });
  return { checkedAt, reservations, notifications: notificationPlan.notifications, errors };
}

function providerRuntime(providerId) {
  if (!providerRuntimeState.has(providerId)) {
    providerRuntimeState.set(providerId, {
      inFlight: false,
      pending: false,
      pendingLogged: false,
      startedAt: null
    });
  }
  return providerRuntimeState.get(providerId);
}

function markProviderPending(state, providerId, slotKey, now) {
  const runtime = providerRuntime(providerId);
  runtime.pending = true;
  const previous = state.system.providers?.[providerId] || {};
  state.system.providers[providerId] = {
    ...previous,
    id: providerId,
    status: "pending",
    pending: true,
    lastProcessedSlotAt: previous.lastProcessedSlotAt === slotKey ? previous.lastProcessedSlotAt : slotKey
  };
  if (!runtime.pendingLogged) {
    addLog(state, `${providerLabel(providerId)} 조회 지연 - 이전 조회 진행 중, 종료 후 즉시 재조회 예정`, now);
    runtime.pendingLogged = true;
  }
}

function finishProviderRuntime(state, providerId, checkedAt, error = null, stats = null) {
  const runtime = providerRuntime(providerId);
  const startedAt = runtime.startedAt;
  const finishedAt = new Date(checkedAt);
  const durationMs = startedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : null;
  inFlightProviders.delete(providerId);
  runtime.inFlight = false;
  runtime.startedAt = null;
  state.system.providers[providerId] = {
    ...(state.system.providers[providerId] || {}),
    id: providerId,
    status: runtime.pending ? "pending" : error ? "error" : "idle",
    pending: runtime.pending,
    lastAttemptAt: checkedAt,
    lastFinishedAt: checkedAt,
    lastDurationMs: durationMs,
    lastError: error ? (typeof error === "string" ? error : error.message) : null,
    lastErrorAt: error ? checkedAt : state.system.providers[providerId]?.lastErrorAt || null,
    lastSuccessfulCheckAt: !error || stats?.success > 0 ? checkedAt : state.system.providers[providerId]?.lastSuccessfulCheckAt || null
  };
}

function runPendingProviderChecks(providerIds, options) {
  for (const providerId of providerIds) {
    const runtime = providerRuntime(providerId);
    if (!runtime.pending || runtime.inFlight) continue;
    runtime.pending = false;
    runtime.pendingLogged = false;
    runCheckCycle({
      ...options,
      source: "scheduler-pending",
      targetProviderIds: [providerId],
      forceDue: true,
      now: new Date()
    }).catch((error) => console.error(`${providerLabel(providerId)} pending check failed: ${error.message}`));
  }
}

function releaseProviderRuntimeLocks(providerIds) {
  for (const providerId of providerIds) {
    const runtime = providerRuntime(providerId);
    inFlightProviders.delete(providerId);
    runtime.inFlight = false;
    runtime.startedAt = null;
  }
}

function summaryVenueIds(targetVenueIds, activeVenueIds, skippedProviders) {
  const skippedProviderIds = new Set(skippedProviders.map((item) => item.provider));
  return Array.from(new Set([
    ...targetVenueIds,
    ...activeVenueIds.filter((venueId) => skippedProviderIds.has(VENUES[venueId]?.provider))
  ]));
}

function addSkipLogs(state, skippedProviders, now) {
  for (const { provider, reason } of skippedProviders) {
    if (provider !== "olympic" || reason !== "운영시간 외") continue;
    addLog(state, `[올림픽공원] 조회 SKIP | 운영시간 외 (${outsideMonitoringHoursLabel(provider)})`, now);
  }
}

function finishRunState(state, now, activeVenueIds, checked = {}, skippedProviders = [], checkedAt = new Date().toISOString()) {
  const skipped = new Map(skippedProviders.map((item) => [item.provider, item.reason]));
  const facilities = {};
  for (const venueId of activeVenueIds) {
    const providerId = VENUES[venueId]?.provider;
    const skippedReason = skipped.get(providerId);
    facilities[venueId] = skippedReason
      ? { provider: providerId, status: "skipped", reason: skippedReason }
      : {
          provider: providerId,
          status: Object.prototype.hasOwnProperty.call(checked, venueId) || Object.prototype.hasOwnProperty.call(checked, providerId) ? "checked" : checkErrorsForVenue(checked, venueId).length > 0 ? "failed" : "not-due",
          count: checked[venueId]?.length ?? checked[providerId]?.length ?? 0
        };
  }
  state.system.lastRun = {
    ...(state.system.lastRun || {}),
    runFinishedAt: checkedAt,
    nextRunAt: state.system.lastRun?.nextRunAt || nextFixedSlotAt(now, 5),
    facilities
  };
  state.system.lastRunAt = checkedAt;
  state.system.nextRunAt = state.system.lastRun.nextRunAt;
  if (successfulVenueIds(activeVenueIds, checked).length > 0) state.system.lastCheckedAt = checkedAt;
  state.system.nextCheckAt = state.system.nextRunAt;
}

function updateCheckedProviderSchedule(state, venueIds, checkedAt) {
  state.system.providers ||= {};
  for (const providerId of activeProviderVenueIds(venueIds).keys()) {
    state.system.providers[providerId] = {
      ...(state.system.providers[providerId] || {}),
      id: providerId,
      pollingMinutes: providerPollingMinutes(providerId),
      lastCheckedAt: checkedAt,
      lastSuccessfulCheckAt: checkedAt
    };
  }
}

function updateAttemptedProviderSchedule(state, venueIds, checkedAt) {
  state.system.providers ||= {};
  for (const providerId of activeProviderVenueIds(venueIds).keys()) {
    state.system.providers[providerId] = {
      ...(state.system.providers[providerId] || {}),
      id: providerId,
      pollingMinutes: providerPollingMinutes(providerId),
      lastAttemptAt: checkedAt
    };
  }
}

export function buildCycleSummary({ checked, activeVenueIds, skippedProviders = [], vacancyCount, alertCount }) {
  const activeProviders = providerTargets(activeVenueIds);
  const checkErrors = checked?.[CHECK_META]?.errors || [];
  const allFailed = Array.from(activeProviders.entries()).every(([providerId, venueIds]) => {
    const stats = providerCheckStats(providerId, venueIds, checked, checkErrors);
    return stats.total > 0 && stats.success === 0 && stats.failed > 0;
  });
  const parts = [allFailed ? "조회실패" : "조회완료"];
  const skipped = new Map(skippedProviders.map((item) => [item.provider, item.reason]));

  for (const providerId of ["gangdong", "songpa", "olympic"]) {
    if (!activeProviders.has(providerId)) continue;
    if (skipped.has(providerId)) {
      parts.push(`${providerLabel(providerId)} SKIP(${skipped.get(providerId)})`);
      continue;
    }
    parts.push(providerSummary(providerId, activeProviders.get(providerId), checked, checkErrors));
  }

  if (!allFailed) {
    const tail = [`빈자리 ${vacancyCount}건`];
    if (vacancyCount > 0) tail.push(`알림 ${alertCount}건`);
    parts.push(tail.join(" → "));
  }
  const detailLines = checkErrors
    .filter((error) => activeProviders.has(error.provider))
    .map((error) => `↳ ${error.venueName || VENUES[error.venueId]?.name || providerLabel(error.provider)}: ${error.type || shortReason(error.message)}${error.targetDate ? ` / ${error.targetDate}` : ""}`);
  const summary = parts.join(" | ");
  return detailLines.length > 0 ? [summary, ...detailLines].join("\n") : summary;
}

function providerLabel(providerId) {
  if (providerId === "gangdong") return "강동";
  if (providerId === "songpa") return "송파";
  if (providerId === "olympic") return "올림픽";
  return providerId;
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
      return "올림픽 0/1 성공 · 1 실패";
    }
    return "올림픽 1/1 성공";
  }

  const label = providerId === "gangdong" ? "강동" : "송파";
  const failedVenueIds = new Set(providerErrors.map((error) => error.venueId).filter(Boolean));
  const successCount = venueIds.filter((venueId) => (
    Object.prototype.hasOwnProperty.call(checked, venueId) && !failedVenueIds.has(venueId)
  )).length;
  const failedCount = Math.max(0, venueIds.length - successCount);
  return failedCount > 0
    ? `${label} ${successCount}/${venueIds.length} 성공 · ${failedCount} 실패`
    : `${label} ${successCount}/${venueIds.length} 성공`;
}

function shortReason(message = "조회 실패") {
  if (/TARGET_DATE_NOT_PARSED|대상날짜 파싱 실패/.test(message)) return "대상날짜 파싱 실패";
  if (/date selector|날짜/.test(message)) return "날짜조회 실패";
  if (/login|로그인/i.test(message)) return "로그인 실패";
  if (/중복|duplicate/i.test(message)) return "중복접속";
  return "조회 실패";
}

function successfulVenueIds(targetVenueIds, checked) {
  return targetVenueIds.filter((venueId) => Object.prototype.hasOwnProperty.call(checked, venueId));
}

function checkErrorsForVenue(checked, venueId) {
  return (checked?.[CHECK_META]?.errors || []).filter((error) => error.venueId === venueId);
}

function providerCheckStats(providerId, venueIds, checked, errors) {
  const providerErrors = errors.filter((error) => error.provider === providerId);
  if (providerId === "olympic") {
    const success = Object.prototype.hasOwnProperty.call(checked, "olympic") && providerErrors.length === 0 ? 1 : 0;
    return { total: 1, success, failed: success ? 0 : providerErrors.length > 0 ? 1 : 0 };
  }
  const failedVenueIds = new Set(providerErrors.map((error) => error.venueId).filter(Boolean));
  const success = venueIds.filter((venueId) => Object.prototype.hasOwnProperty.call(checked, venueId) && !failedVenueIds.has(venueId)).length;
  return { total: venueIds.length, success, failed: Math.max(0, venueIds.length - success) };
}

function providerErrorMessage(errors, providerId) {
  const providerErrors = errors.filter((error) => error.provider === providerId);
  if (providerErrors.length === 0) return null;
  return providerErrors
    .map((error) => `${error.venueName || VENUES[error.venueId]?.name || providerLabel(providerId)}: ${error.type || shortReason(error.message)} ${error.message || ""}`.trim())
    .join("; ");
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
        const key = reservationKey({ venue, date: watch.date, time });
        const item = byKey.get(key);
        if (item?.available) matches.add(key);
      }
    }
  }

  return matches.size;
}

export function resetSchedulerRuntimeForTests() {
  inFlightProviders.clear();
  providerRuntimeState.clear();
}

function normalizeOlympicWatch(watch) {
  return {
    ...watch,
    provider: "olympic",
    venue: "olympic",
    date: normalizeDate(watch.date) || watch.date,
    times: (watch.times || []).map((time) => normalizeTimeSlot(time) || time),
  };
}

export function startScheduler() {
  if (schedulerTask) return schedulerTask;
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
    for (const providerId of Object.keys(PROVIDERS)) {
      runCheckCycle({ targetProviderIds: [providerId] }).catch((error) => {
        console.error(`${providerLabel(providerId)} check cycle failed: ${error.message}`);
      });
    }
  }, { timezone: SERVICE_TIME_ZONE });
  schedulerTask = task;
  console.log(`Scheduler started: provider polling due check every 1 minute.`);
  console.log(`Scheduler version: ${SCHEDULER_VERSION}`);
  console.log(`Polling | 강동 ${PROVIDERS.gangdong.pollingMinutes}분 | 송파 ${PROVIDERS.songpa.pollingMinutes}분 | 올림픽 ${PROVIDERS.olympic.pollingMinutes}분`);
  return task;
}
