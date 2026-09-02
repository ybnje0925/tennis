export const SERVICE_TIME_ZONE = "Asia/Seoul";

export function parseIsoDateParts(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

export function dateOnlyToKstDate(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, -9, 0, 0));
}

export function dateOnlyToKstTimestamp(value) {
  const date = dateOnlyToKstDate(value);
  return date ? date.getTime() : Number.POSITIVE_INFINITY;
}

export function formatKoreanDateWithWeekday(value) {
  const parts = parseIsoDateParts(value);
  const date = dateOnlyToKstDate(value);
  if (!parts || !date) return String(value || "");

  const weekday = new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
    timeZone: SERVICE_TIME_ZONE
  }).format(date);

  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} (${weekday})`;
}

export function formatKoreanFullDateWithWeekday(value) {
  const parts = parseIsoDateParts(value);
  const date = dateOnlyToKstDate(value);
  if (!parts || !date) return String(value || "");

  const weekday = new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
    timeZone: SERVICE_TIME_ZONE
  }).format(date);

  return `${parts.year}년 ${parts.month}월 ${parts.day}일 (${weekday})`;
}
