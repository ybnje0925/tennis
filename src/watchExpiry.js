import { normalizeDate } from "./normalization.js";

// All users share provider polling, so expiry must apply to every saved watch.
export function disableExpiredWatches(state, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).map(part => [part.type, part.value]));
  const today = parts.year + "-" + parts.month + "-" + parts.day;
  let changed = false;
  for (const watch of state.watches || []) {
    const date = normalizeDate(watch.date);
    if (watch.enabled !== true || !date || date >= today) continue;
    watch.enabled = false;
    watch.autoDisabledReason = "DATE_PASSED";
    watch.autoDisabledAt = now.toISOString();
    changed = true;
  }
  return changed;
}
