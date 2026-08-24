import cron from "node-cron";
import { config } from "./config.js";
import { VENUES } from "./constants.js";
import { checkAllVenues } from "./checker.js";
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

export function findNotifications(state, reservations) {
  const olympicSlots = reservations.filter((item) => item.provider === "olympic");
  const byKey = new Map(reservations.map((item) => [keyFor(item), item]));
  const notifications = [];

  for (const watch of state.watches.filter((item) => item.enabled !== false)) {
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
  state.system.logs = state.system.logs.slice(-80);
}

export function nextRunAt(date = new Date(), minuteStep = config.checkIntervalMinutes) {
  const next = new Date(date);
  const minutes = next.getMinutes();
  const addMinutes = minuteStep - (minutes % minuteStep || minuteStep);
  next.setMinutes(minutes + addMinutes, 0, 0);
  if (next <= date) next.setMinutes(next.getMinutes() + minuteStep, 0, 0);
  return next.toISOString();
}

export async function runCheckCycle({ checker = checkAllVenues, notifier = sendTelegram, forceCheck = false } = {}) {
  const state = await loadState();
  const enabledWatches = state.watches.filter((watch) => watch.enabled !== false);
  if (enabledWatches.length === 0 && !forceCheck) {
    const checkedAt = new Date().toISOString();
    state.system.lastCheckedAt = checkedAt;
    state.system.nextCheckAt = nextRunAt();
    addLog(state, "등록된 활성 알림 조건이 없어 조회를 건너뜀");
    await saveState(state);
    return { checkedAt, reservations: [], notifications: [], errors: [] };
  }

  let checked;
  const errors = [];
  try {
    checked = await checker({ watches: enabledWatches });
  } catch (error) {
    const checkedAt = new Date().toISOString();
    state.system.lastCheckedAt = checkedAt;
    state.system.nextCheckAt = nextRunAt();
    addLog(state, `예약현황 조회 실패: ${error.message}`);
    await saveState(state);
    return { checkedAt, reservations: [], notifications: [], errors: [error.message] };
  }

  const reservations = Object.values(checked).flat();
  const notifications = forceCheck && enabledWatches.length === 0 ? [] : findNotifications(state, reservations);

  const checkedAt = new Date().toISOString();
  for (const venueId of Object.keys(checked)) {
    const count = checked[venueId]?.length ?? 0;
    state.system.venues[venueId] = {
      ok: count > 0,
      checkedAt,
      count
    };
    addLog(state, `${VENUES[venueId].name} 조회 ${count > 0 ? "성공" : "결과 없음"}`);
  }

  for (const notification of notifications) {
    try {
      await notifier(buildNotificationMessage(notification.item));
      state.sentNotifications[`${notification.watch.id}|${notification.key}`] = checkedAt;
      addLog(
        state,
        `${notification.item.time} 예약가능 ${notification.item.availableCount}개 감지, Telegram 알림 발송 성공`
      );
    } catch (error) {
      errors.push(error.message);
      addLog(state, `Telegram 알림 발송 실패: ${error.message}`);
    }
  }
  if (notifications.length === 0) addLog(state, "빈자리 알림 대상 없음");

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
  await saveState(state);
  state.system.lastCheckedAt = checkedAt;
  state.system.nextCheckAt = nextRunAt();
  await saveState(state);
  return { checkedAt, reservations, notifications, errors };
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
  const minuteStep = Math.max(1, config.checkIntervalMinutes);
  const expression = `*/${minuteStep} * * * *`;
  loadState()
    .then((state) => {
      state.system.nextCheckAt = nextRunAt();
      return saveState(state);
    })
    .catch((error) => console.error(`Scheduler state update failed: ${error.message}`));
  const task = cron.schedule(expression, () => {
    runCheckCycle().catch((error) => {
      console.error(`Check cycle failed: ${error.message}`);
    });
  });
  console.log(`Scheduler started: every ${minuteStep} minutes for ${Object.keys(VENUES).length} venues.`);
  return task;
}
