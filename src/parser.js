import { TIME_SLOTS, VENUES } from "./constants.js";

export function parseKoreanDate(text, fallbackYear = new Date().getFullYear()) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const full = normalized.match(/(20\d{2})[-./년\s]+([01]?\d)[-./월\s]+([0-3]?\d)/);
  if (full) return toIsoDate(full[1], full[2], full[3]);
  const short = normalized.match(/([01]?\d)[-./월\s]+([0-3]?\d)/);
  if (short) return toIsoDate(fallbackYear, short[1], short[2]);
  return null;
}

function toIsoDate(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function parseAvailableCount(text) {
  const direct = text.match(/예약가능\s*\(?\s*(\d+)\s*\)?/);
  if (direct) return Number.parseInt(direct[1], 10);
  const paren = text.match(/\((\d+)\)/);
  return paren ? Number.parseInt(paren[1], 10) : 0;
}

export async function parseReservationDom(page, venueId) {
  const rows = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("tr, td, th, li, div, span, a"));
    return elements
      .map((element) => {
        const text = element.innerText || element.textContent || "";
        const aria = element.getAttribute("aria-label") || "";
        const title = element.getAttribute("title") || "";
        return `${text} ${aria} ${title}`.replace(/\s+/g, " ").trim();
      })
      .filter((text) => /예약가능|예약완료/.test(text));
  });

  return parseReservationTexts(rows, venueId);
}

export function parseReservationTexts(texts, venueId, fallbackYear = new Date().getFullYear()) {
  const venue = VENUES[venueId];
  if (!venue) throw new Error(`Unknown venue: ${venueId}`);

  const results = [];
  let currentDate = null;

  for (const raw of texts) {
    const text = raw.replace(/\s+/g, " ").trim();
    const date = parseKoreanDate(text, fallbackYear);
    if (date) currentDate = date;

    for (const slot of TIME_SLOTS) {
      const compactSlot = slot.replace(/:00/g, "");
      const compactText = text.replace(/\s/g, "");
      const hasSlot = text.includes(slot) || compactText.includes(compactSlot);
      const hasStatus = /예약가능|예약완료/.test(text);
      if (!hasSlot || !hasStatus) continue;

      const itemDate = date || currentDate;
      if (!itemDate) continue;

      const available = text.includes("예약가능");
      results.push({
        venue: venue.id,
        venueName: venue.name,
        date: itemDate,
        time: slot,
        available,
        availableCount: available ? parseAvailableCount(text) : 0
      });
    }
  }

  const map = new Map();
  for (const item of results) map.set(`${item.venue}|${item.date}|${item.time}`, item);
  return Array.from(map.values()).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
