import { dateOnlyToKstTimestamp } from "./dateFormat.js";

export function earliestStartMinutes(times = []) {
  const values = times
    .map((time) => String(time || "").match(/^(\d{1,2}):(\d{2})/))
    .filter(Boolean)
    .map((match) => Number(match[1]) * 60 + Number(match[2]));
  return values.length > 0 ? Math.min(...values) : Number.POSITIVE_INFINITY;
}

export function compareWatchesByReservationTime(left, right) {
  const dateDiff = dateOnlyToKstTimestamp(left?.date) - dateOnlyToKstTimestamp(right?.date);
  if (dateDiff !== 0) return dateDiff;

  const timeDiff = earliestStartMinutes(left?.times) - earliestStartMinutes(right?.times);
  if (timeDiff !== 0) return timeDiff;

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function sortWatchesByReservationTime(watches = []) {
  return [...watches].sort(compareWatchesByReservationTime);
}
