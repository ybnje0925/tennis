export function normalizeDate(value, fallbackYear = new Date().getFullYear()) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const isoLike = text.match(/^(20\d{2})-([01]\d)-([0-3]\d)$/);
  if (isoLike) return toIsoDate(isoLike[1], isoLike[2], isoLike[3]);

  const full = text.match(/(20\d{2})\s*(?:[-./]\s*([01]?\d)\s*[-./]\s*([0-3]?\d)|년\s*([01]?\d)\s*월\s*([0-3]?\d)\s*일?)/);
  if (full) return toIsoDate(full[1], full[2] || full[4], full[3] || full[5]);

  const short = text.match(/([01]?\d)\s*(?:[-./]\s*([0-3]?\d)|월\s*([0-3]?\d)\s*일?)/);
  if (short) return toIsoDate(fallbackYear, short[1], short[2] || short[3]);

  return null;
}

export function normalizeTimeSlot(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const match = text.match(/\b([0-2]?\d):?([0-5]\d)?\s*~\s*([0-2]?\d):?([0-5]\d)?\b/);
  if (!match) return null;

  const startHour = Number.parseInt(match[1], 10);
  const endHour = Number.parseInt(match[3], 10);
  const startMinute = match[2] ?? "00";
  const endMinute = match[4] ?? "00";
  if (startHour > 23 || endHour > 24) return null;

  return `${String(startHour).padStart(2, "0")}:${startMinute}~${String(endHour).padStart(2, "0")}:${endMinute}`;
}

export function reservationKey(item) {
  const date = normalizeDate(item.date);
  const time = normalizeTimeSlot(item.time);
  return [item.venue, date, time].join("|");
}

function toIsoDate(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}
