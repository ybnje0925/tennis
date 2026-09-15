import { VENUES } from "./constants.js";
import { normalizeDate, normalizeTimeSlot, reservationKey } from "./normalization.js";

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function pageYearMonth(html) {
  const header = stripTags(String(html).match(/calendar1_yearmonth[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || html)
    .match(/(20\d{2})\s*[.\-/년]\s*([01]?\d)/);
  return header ? `${header[1]}-${String(header[2]).padStart(2, "0")}` : null;
}

function parseCount(text) {
  const match = text.match(/\((\d+)(?:\/\d+)?\)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function parseLegacyCalendarHtml(html, venueId, provider) {
  const venue = VENUES[venueId];
  if (!venue) throw new Error(`Unknown venue: ${venueId}`);
  const yearMonth = pageYearMonth(html);
  if (!yearMonth) throw new Error(`${venue.name} 달력 연월을 읽지 못했습니다.`);
  const results = [];
  const cells = [...String(html).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
  for (const cellMatch of cells) {
    const cellHtml = cellMatch[1];
    const cellText = stripTags(cellHtml);
    const day = cellText.match(/^([0-3]?\d)\b/)?.[1];
    if (!day) continue;
    const lis = [...cellHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    for (const li of lis) {
      const text = stripTags(li[1]);
      const slot = normalizeTimeSlot(text.match(/\b[0-2]?\d\s*:\s*[0-5]?\d\s*~\s*[0-2]?\d\s*:\s*[0-5]?\d\b/)?.[0] || "");
      const status = text.match(/예약가능|예약완료|예약불가/)?.[0];
      if (!slot || !status) continue;
      const available = status === "예약가능";
      results.push({
        provider,
        venue: venue.id,
        venueName: venue.name,
        date: normalizeDate(`${yearMonth}-${String(day).padStart(2, "0")}`),
        time: slot,
        startTime: slot.split("~")[0],
        endTime: slot.split("~")[1],
        durationMinutes: 120,
        available,
        availableCount: available ? parseCount(text) : 0,
        rawStatus: text
      });
    }
  }
  return Array.from(new Map(results.map((item) => [reservationKey(item), item])).values())
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

