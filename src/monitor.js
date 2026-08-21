import cron from "node-cron";
import { config } from "./config.js";
import { VENUES } from "./constants.js";
import { checkAllVenues } from "./checker.js";
import { buildNotificationMessage, sendTelegram } from "./telegram.js";
import { loadState, saveState } from "./storage.js";

export function keyFor(item) {
  return `${item.venue}|${item.date}|${item.time}`;
}

export function findNotifications(state, reservations) {
  const byKey = new Map(reservations.map((item) => [keyFor(item), item]));
  const notifications = [];

  for (const watch of state.watches) {
    for (const venue of watch.venues) {
      for (const time of watch.times) {
        const key = `${venue}|${watch.date}|${time}`;
        const item = byKey.get(key);
        if (!item || !item.available) continue;

        const previous = state.lastAvailability[key];
        const wasUnavailable = previous === false || previous == null;
        const alreadySent = state.sentNotifications[`${watch.id}|${key}`];
        if (wasUnavailable && !alreadySent) notifications.push({ watch, item, key });
      }
    }
  }

  return notifications;
}

export async function runCheckCycle({ checker = checkAllVenues, notifier = sendTelegram } = {}) {
  const state = await loadState();
  const checked = await checker();
  const reservations = Object.values(checked).flat();
  const notifications = findNotifications(state, reservations);

  for (const notification of notifications) {
    await notifier(buildNotificationMessage(notification.item));
    state.sentNotifications[`${notification.watch.id}|${notification.key}`] = new Date().toISOString();
  }

  for (const item of reservations) {
    state.lastAvailability[keyFor(item)] = item.available;
  }
  await saveState(state);
  return { checkedAt: new Date().toISOString(), reservations, notifications };
}

export function startScheduler() {
  const minuteStep = Math.max(1, config.checkIntervalMinutes);
  const expression = `*/${minuteStep} * * * *`;
  const task = cron.schedule(expression, () => {
    runCheckCycle().catch((error) => {
      console.error(`Check cycle failed: ${error.message}`);
    });
  });
  console.log(`Scheduler started: every ${minuteStep} minutes for ${Object.keys(VENUES).length} venues.`);
  return task;
}
