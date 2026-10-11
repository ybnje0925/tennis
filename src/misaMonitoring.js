import * as holidays from "@hyunbinseo/holidays-kr/all";

export function isMisaVenue(venueId) {
  return venueId === "misa-all" || /^misa-court-[1-4]$/.test(venueId);
}

// Reservation desk hours and date window, not the court's playing hours.
// Unknown holiday years stay paused until the bundled calendar is updated.
export function canCheckMisaDate(date, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const local = new Date(now.getTime() + 9 * 3600000);
  const today = local.toISOString().slice(0, 10);
  const calendar = holidays["y" + local.getUTCFullYear()];
  const weekday = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (!calendar || weekday === 0 || weekday === 6 || calendar[today] || minute < 540 || minute >= 1080) return false;
  const target = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) return false;
  const days = (target - Date.parse(today + "T00:00:00Z")) / 86400000;
  return days >= 3 && days <= 15;
}

export function filterMisaMonitoringWatches(watches, now = new Date()) {
  return watches.map(watch => ({ ...watch, venues: (watch.venues || []).filter(id => !isMisaVenue(id) || canCheckMisaDate(watch.date, now)) }))
    .filter(watch => watch.venues.length);
}
