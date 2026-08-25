import { TIME_SLOTS, VENUES } from "./constants.js";
import { normalizeDate, normalizeTimeSlot, reservationKey } from "./normalization.js";

export function parseKoreanDate(text, fallbackYear = new Date().getFullYear()) {
  return normalizeDate(text, fallbackYear);
}

function parseAvailableCount(text) {
  const direct = text.match(/예약가능\s*\(?\s*(\d+)\s*\)?/);
  if (direct) return Number.parseInt(direct[1], 10);
  const paren = text.match(/\((\d+)\)/);
  return paren ? Number.parseInt(paren[1], 10) : 0;
}

export async function parseReservationDom(page, venueId) {
  const calendarItems = await page.evaluate((venue) => {
    const normalizeSpaces = (value) => (value || "").replace(/\s+/g, " ").trim();
    const parseYearMonth = (text) => {
      const match = normalizeSpaces(text).match(/(20\d{2})\s*(?:[.\-/년])\s*([01]?\d)\s*(?:월)?/);
      if (!match) return null;
      const monthNumber = Number.parseInt(match[2], 10);
      if (monthNumber < 1 || monthNumber > 12) return null;
      return { year: match[1], month: String(monthNumber).padStart(2, "0") };
    };
    const findYearMonth = (cell) => {
      const calendar = cell.closest(".calendar1_table");
      const table = cell.closest("table");
      const containers = [
        calendar?.parentElement,
        calendar,
        table?.caption,
        table?.closest(".calendar, .calendar_wrap, .cal_wrap, .reservation, .rent, .contents, form, section, article, div"),
        table
      ].filter(Boolean);

      for (const element of containers) {
        const text = normalizeSpaces(element.innerText || element.textContent || "");
        const yearMonth = parseYearMonth(text);
        if (yearMonth) return yearMonth;
      }
      return null;
    };

    const calendarCells = Array.from(document.querySelectorAll(".calendar1_table td"));
    const cells = calendarCells.length > 0
      ? calendarCells
      : Array.from(document.querySelectorAll("table td"));

    return cells.flatMap((cell) => {
      const yearMonth = findYearMonth(cell);
      if (!yearMonth) return [];

      const cellText = normalizeSpaces(cell.innerText || cell.textContent || "");
      const day = cellText.match(/^([0-3]?\d)\b/)?.[1];
      if (!day) return [];

      return Array.from(cell.querySelectorAll("li")).flatMap((item) => {
        const text = normalizeSpaces(item.innerText || item.textContent || "");
        const slot = text.match(/\b[0-2]?\d:?[0-5]?\d?\s*~\s*[0-2]?\d:?[0-5]?\d?\b/)?.[0];
        const status = text.match(/예약가능|예약완료/)?.[0];
        if (!slot || !status) return [];

        const count = text.match(/\((\d+)\)/)?.[1];
        const available = status === "예약가능";
        return {
          venue,
          date: `${yearMonth.year}-${yearMonth.month}-${day.padStart(2, "0")}`,
          time: slot,
          available,
          availableCount: available && count ? Number.parseInt(count, 10) : 0
        };
      });
    });
  }, venueId);

  if (calendarItems.length > 0) {
    return normalizeReservations(calendarItems, venueId);
  }

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
      const normalizedSlot = normalizeTimeSlot(text);
      const compactSlot = slot.replace(/:00/g, "");
      const compactText = text.replace(/\s/g, "");
      const hasSlot = normalizedSlot === slot || text.includes(slot) || compactText.includes(compactSlot);
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

  return normalizeReservations(results, venueId);
}

function normalizeReservations(items, venueId) {
  const venue = VENUES[venueId];
  const map = new Map();

  for (const item of items) {
    const normalized = {
      venue: venue.id,
      venueName: venue.name,
      date: normalizeDate(item.date),
      time: normalizeTimeSlot(item.time),
      available: item.available,
      availableCount: item.available ? item.availableCount : 0
    };
    if (!normalized.date || !normalized.time) continue;

    const key = reservationKey(normalized);
    const previous = map.get(key);
    map.set(key, previous ? mergeReservation(previous, normalized) : normalized);
  }

  return Array.from(map.values()).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function mergeReservation(previous, next) {
  const available = previous.available || next.available;
  return {
    ...previous,
    ...next,
    available,
    availableCount: available ? Math.max(previous.availableCount || 0, next.availableCount || 0) : 0
  };
}
