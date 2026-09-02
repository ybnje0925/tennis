import { PROVIDERS, TIME_SLOTS, VENUES } from "../constants.js";
import { diagnosticError } from "../diagnostics.js";
import { normalizeDate, normalizeTimeSlot } from "../normalization.js";
import { createProviderTimer } from "../providerTiming.js";

const CHECK_META = Symbol.for("tennis.checkMeta");
const HANAM_BASE_URL = "https://rent.hanamsport.or.kr/hanam_rent_ms/";
const HANAM_DAY_STATE_URL = "https://rent.hanamsport.or.kr/hanam_rent_ms/center/ajax.rent.day.state.new.php";
const HANAM_TIME_URL = "https://rent.hanamsport.or.kr/hanam_rent_ms/center/ajax.day.rent.list.php";
const MISA_URL = "https://www.hanam.go.kr/www/selectMisaParkResveWeb.do";
const MISA_COURTS = {
  1: "TS01",
  2: "TS02",
  3: "TS03",
  4: "TS04"
};

export function isHanamWatch(watch) {
  return (watch.venues || []).some((venueId) => VENUES[venueId]?.provider === "hanam");
}

export function hanamKeyFor(item) {
  return [
    item.provider || "hanam",
    item.venue,
    item.courtNo || "",
    normalizeDate(item.date),
    item.startTime,
    item.endTime
  ].join("|");
}

export function filterHanamSlotsByWatch(slots, watch) {
  const venueIds = new Set(watch.venues || []);
  const times = new Set((watch.times || []).map((time) => normalizeTimeSlot(time) || time));
  return slots.filter((slot) => (
    slot.provider === "hanam" &&
    slot.available &&
    slot.date === normalizeDate(watch.date) &&
    times.has(slot.time) &&
    (venueIds.has(slot.venue) || (venueIds.has("misa-all") && slot.facilityGroup === "misa"))
  ));
}

export function hanamVenueIdsFromWatches(watches) {
  return Array.from(new Set(
    watches.flatMap((watch) => watch.venues || []).filter((venueId) => VENUES[venueId]?.provider === "hanam")
  ));
}

export async function checkHanamVenues(venueIds, options = {}) {
  const ids = venueIds.filter((venueId) => VENUES[venueId]?.provider === "hanam");
  if (ids.length === 0) return {};

  const timer = createProviderTimer("하남");
  const result = {};
  const errors = [];
  let errorForTimer = null;

  try {
    for (const venueId of ids) {
      try {
        result[venueId] = await timer.step(`${VENUES[venueId].name} 조회`, () => checkHanamVenue(venueId, options));
      } catch (error) {
        const diagnostic = {
          provider: "hanam",
          venueId,
          venueName: VENUES[venueId]?.name,
          targetDate: options.venueDates?.[venueId]?.join(", ") || null,
          stage: error.stage || "PARSE",
          type: error.type || error.code || "PARSE_FAILED",
          message: error.message,
          retryable: Boolean(error.retryable),
          stack: error.stack
        };
        errors.push(diagnostic);
        console.warn(`하남 조회 실패 | venue=${VENUES[venueId]?.name || venueId} | type=${diagnostic.type} | message=${diagnostic.message}`);
      }
    }

    Object.defineProperty(result, CHECK_META, {
      value: { errors },
      enumerable: false,
      configurable: true
    });
    return result;
  } catch (error) {
    errorForTimer = error;
    throw error;
  } finally {
    timer.end(errorForTimer);
  }
}

async function checkHanamVenue(venueId, options) {
  if (venueId.startsWith("hanam-tennis-")) return checkHanamSportVenue(venueId, options);
  if (venueId === "misa-all" || venueId.startsWith("misa-court-")) return checkMisaVenue(venueId, options);
  return [];
}

async function checkHanamSportVenue(venueId, options) {
  const venue = VENUES[venueId];
  const dates = options.venueDates?.[venueId] || watchDatesForVenue(options.watches, venueId);
  const results = [];
  if (dates.length === 0) return results;

  const session = await fetchHanamSession(venue.placeCode);
  for (const date of dates) {
    const status = await fetchHanamDateStatus(date, venue.placeCode, session.cookie);
    if (!status) throw parseError("CALENDAR_DATE_NOT_FOUND", venueId, date, "하남 달력에서 대상 날짜를 찾지 못했습니다.");

    const requestedTimes = watchTimesForVenue(options.watches, venueId, date, "hanam");
    if (isHanamDateClosed(status)) {
      results.push(...requestedTimes.map((time) => unavailableItem(venueId, date, time, { rawStatus: JSON.stringify(status) })));
      logProviderResult("HANAM", venueId, date, requestedTimes, 0, "SUCCESS");
      continue;
    }

    const slots = await fetchHanamTimeSlots(date, venueId, session);
    if (slots.length === 0 && isHanamDateOpen(status)) {
      throw parseError("TIME_SLOTS_MISSING", venueId, date, "하남 달력은 대관가능인데 시간표 응답이 비어 있습니다.");
    }
    const slotsByTime = collapseFacilitySlotsByTime(slots);
    for (const time of requestedTimes) {
      results.push(slotsByTime.get(time) || unavailableItem(venueId, date, time));
    }
    logProviderResult("HANAM", venueId, date, requestedTimes, results.filter((item) => item.venue === venueId && item.date === date && item.available).length, "SUCCESS");
  }

  return results;
}

async function fetchHanamSession(placeCode) {
  const response = await fetch(`${HANAM_BASE_URL}?place_code=${encodeURIComponent(placeCode)}`, {
    headers: { "user-agent": "Mozilla/5.0 tennis-jabajwo" }
  });
  if (!response.ok) throw parseError("HTTP_ERROR", null, null, `하남국민체육센터 HTTP ${response.status}`);
  const html = await response.text();
  return {
    cookie: String(response.headers.get("set-cookie") || "").split(",").map((part) => part.split(";")[0]).filter(Boolean).join("; "),
    rentOpenStartDay: html.match(/id=["']Rent_Open_Start_Day["'][^>]+value=["']([^"']*)["']/i)?.[1] || ""
  };
}

async function fetchHanamDateStatus(date, placeCode, cookie) {
  const lastdate = lastDayOfMonth(date);
  const body = new URLSearchParams({
    center_id: "01",
    date: date.replaceAll("-", ""),
    lastdate,
    place_code: placeCode
  });
  const json = await postJson(HANAM_DAY_STATE_URL, body, cookie, `${HANAM_BASE_URL}?place_code=${placeCode}`);
  return json?.[date] || null;
}

async function fetchHanamTimeSlots(date, venueId, session) {
  const venue = VENUES[venueId];
  const body = new URLSearchParams({
    center_id: "01",
    rdate: date.replaceAll("-", ""),
    rent_open_start_day: session.rentOpenStartDay,
    place_code: venue.placeCode,
    Rstep: ""
  });
  const json = await postJson(HANAM_TIME_URL, body, session.cookie, `${HANAM_BASE_URL}?place_code=${venue.placeCode}`);
  return parseHanamTimeResponse(json, venueId, date);
}

export function parseHanamDateStatusResponse(json, date) {
  if (!json || typeof json !== "object") throw parseError("PARSE_FAILED", null, date, "하남 날짜 상태 응답이 JSON 객체가 아닙니다.");
  const status = json[date];
  if (!status?.rday2 || normalizeDate(status.rday2) !== date) throw parseError("CALENDAR_DATE_NOT_FOUND", null, date, "하남 날짜 상태 응답에서 대상 날짜를 찾지 못했습니다.");
  return status;
}

export function parseHanamTimeResponse(json, venueId, date) {
  if (!json || typeof json !== "object") throw parseError("PARSE_FAILED", venueId, date, "하남 시간표 응답이 JSON 객체가 아닙니다.");
  if (json.rstate === "9") throw parseError("HTTP_BLOCKED_OR_NOT_FOUND", venueId, date, json.error || "하남 시간표 접근이 거부되었습니다.");
  if (!Object.prototype.hasOwnProperty.call(json, "play_name")) throw parseError("PARSE_FAILED", venueId, date, "하남 시간표 응답에 play_name이 없습니다.");

  const raw = parseMaybeJson(json.play_name);
  if (raw === "" || raw == null) return [];
  if (!Array.isArray(raw)) throw parseError("PARSE_FAILED", venueId, date, "하남 시간표 play_name 구조가 배열이 아닙니다.");

  const slots = [];
  for (const court of raw) {
    const courtNo = extractCourtNo(court.play_name || court.tcode);
    for (const slot of parseSlotHtml(court.htmlx || court.html || "")) {
      slots.push({
        provider: "hanam",
        venue: venueId,
        venueName: VENUES[venueId].name,
        courtNo,
        date,
        ...slot,
        durationMinutes: minutesBetween(slot.startTime, slot.endTime)
      });
    }
  }
  return uniqueSlots(slots);
}

function isHanamDateClosed(status) {
  return Number(status.h_cnt || 0) > 0 || Number(status.t_cnt || 0) === 1;
}

function isHanamDateOpen(status) {
  return !isHanamDateClosed(status) && (
    Number(status.rstate || 0) > 0 ||
    Number(status.sum_tot || 0) > 0 ||
    Number(status.total_count || 0) > 0
  );
}

function lastDayOfMonth(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${date.slice(0, 4)}${date.slice(5, 7)}${String(day).padStart(2, "0")}`;
}

async function postJson(url, body, cookie, referer) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": "Mozilla/5.0 tennis-jabajwo",
      referer,
      ...(cookie ? { cookie } : {})
    },
    body
  });
  const text = await response.text();
  if (!response.ok) throw parseError("HTTP_ERROR", null, null, `HTTP ${response.status}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw parseError("PARSE_FAILED", null, null, `JSON 파싱 실패: ${error.message}`);
  }
}

async function checkMisaVenue(venueId, options) {
  const dates = options.venueDates?.[venueId] || watchDatesForVenue(options.watches, venueId);
  const results = [];
  for (const date of dates) {
    const requestedTimes = watchTimesForVenue(options.watches, venueId, date, "misa");
    const courts = venueId === "misa-all" ? ["1", "2", "3", "4"] : [VENUES[venueId].misaCourt];
    for (const courtNo of courts) {
      const html = await fetchMisaHtml({ date, courtNo });
      const slots = parseMisaReservationHtml(html, { venueId, date, courtNo });
      const byTime = new Map(slots.map((slot) => [slot.time, slot]));
      for (const time of requestedTimes) {
        const parsed = byTime.get(time) || unavailableItem(venueId, date, time, { courtNo, facilityGroup: "misa" });
        results.push(venueId === "misa-all" ? { ...parsed, venue: "misa-all", venueName: VENUES["misa-all"].name } : parsed);
      }
    }
    logProviderResult("MISA", venueId, date, requestedTimes, results.filter((item) => item.date === date && item.available).length, "SUCCESS");
  }
  return uniqueSlots(results);
}

async function fetchMisaHtml({ date, courtNo }) {
  const params = new URLSearchParams({
    key: "7465",
    yyyymm: date.slice(0, 7).replace("-", ""),
    misaParkCode: MISA_COURTS[courtNo],
    searchCategoryCode: "B1",
    searchResveDate: date.replaceAll("-", "")
  });
  const response = await fetch(`${MISA_URL}?${params}`, {
    headers: { "user-agent": "Mozilla/5.0 tennis-jabajwo" }
  });
  if (!response.ok) throw parseError("HTTP_ERROR", null, date, `미사한강공원 HTTP ${response.status}`);
  return response.text();
}

export function parseMisaReservationHtml(html, { venueId, date, courtNo }) {
  const tbody = String(html || "").match(/<tbody[^>]*id=["']dynamicTbody["'][^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (tbody == null) throw parseError("PARSE_FAILED", venueId, date, "미사 시간표 tbody를 찾지 못했습니다.");

  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rows.length === 0) return [];

  return rows.map((row) => {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripTags(match[1]));
    if (cells.length < 3) throw parseError("PARSE_FAILED", venueId, date, "미사 시간표 행 구조가 변경되었습니다.");
    const rowDate = normalizeDate(cells[0]);
    const time = normalizeTimeSlot(cells[1]);
    if (!rowDate || !time) throw parseError("PARSE_FAILED", venueId, date, "미사 날짜/시간 파싱에 실패했습니다.");
    const [startTime, endTime] = time.split("~");
    const actionText = stripTags(row[1]);
    const available = /예약하기|신청가능/.test(actionText) && !/예약완료|완료\/신청불가|신청불가/.test(actionText);
    return {
      provider: "hanam",
      facilityGroup: "misa",
      venue: venueId,
      venueName: VENUES[venueId].name,
      courtNo,
      courtName: `${courtNo}코트`,
      date: rowDate,
      startTime,
      endTime,
      time,
      durationMinutes: minutesBetween(startTime, endTime),
      available,
      rawStatus: actionText
    };
  }).filter((slot) => slot.date === date);
}

function parseSlotHtml(html) {
  const chunks = String(html || "").split(/<\/(?:li|tr|p|div)>/i);
  const slots = [];
  for (const chunk of chunks) {
    const text = stripTags(chunk);
    const time = normalizeTimeSlot(text);
    if (!time) continue;
    const [startTime, endTime] = time.split("~");
    const markup = `${text} ${chunk}`;
    const unavailable = /예약완료|대관마감|마감|불가|disabled|disable|nochk|r_end/i.test(markup);
    const selectableInput = /name=['"]ct_chk\[\]/i.test(chunk) && !unavailable;
    const available = (/예약가능|대관가능|신청가능|예약하기|가능/i.test(markup) || selectableInput) && !unavailable;
    slots.push({ startTime, endTime, time, available, rawStatus: text });
  }
  return slots;
}

function collapseFacilitySlotsByTime(slots) {
  const byTime = new Map();
  for (const slot of slots) {
    const facilitySlot = {
      ...slot,
      courtNo: undefined,
      courtName: undefined,
      rawCourtNo: slot.courtNo
    };
    const previous = byTime.get(slot.time);
    if (!previous || (!previous.available && facilitySlot.available)) {
      byTime.set(slot.time, facilitySlot);
    }
  }
  return byTime;
}

function watchDatesForVenue(watches = [], venueId) {
  return Array.from(new Set(
    watches
      .filter((watch) => watch.enabled !== false && (watch.venues || []).includes(venueId))
      .map((watch) => normalizeDate(watch.date))
      .filter(Boolean)
  )).sort();
}

function watchTimesForVenue(watches = [], venueId, date, type) {
  const fallback = type === "misa" ? TIME_SLOTS : [];
  const times = watches
    .filter((watch) => watch.enabled !== false && (watch.venues || []).includes(venueId) && normalizeDate(watch.date) === date)
    .flatMap((watch) => watch.times || [])
    .map((time) => normalizeTimeSlot(time))
    .filter(Boolean);
  return Array.from(new Set(times.length > 0 ? times : fallback)).sort();
}

function unavailableItem(venueId, date, time, extra = {}) {
  const normalizedTime = normalizeTimeSlot(time);
  const [startTime, endTime] = normalizedTime.split("~");
  return {
    provider: "hanam",
    venue: venueId,
    venueName: VENUES[venueId].name,
    date,
    startTime,
    endTime,
    time: normalizedTime,
    durationMinutes: minutesBetween(startTime, endTime),
    available: false,
    ...extra
  };
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  let parsed = value;
  for (let i = 0; i < 2; i += 1) {
    if (typeof parsed !== "string") return parsed;
    const trimmed = parsed.trim();
    if (!trimmed) return "";
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw parseError("PARSE_FAILED", null, null, `하남 play_name JSON 파싱 실패: ${error.message}`);
    }
  }
  return parsed;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCourtNo(value) {
  return String(value || "").match(/([1-9]\d*)/)?.[1] || undefined;
}

function minutesBetween(startTime, endTime) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function uniqueSlots(slots) {
  return Array.from(new Map(slots.map((slot) => [hanamKeyFor(slot), slot])).values())
    .sort((a, b) => `${a.venue} ${a.date} ${a.startTime} ${a.courtNo || ""}`.localeCompare(`${b.venue} ${b.date} ${b.startTime} ${b.courtNo || ""}`));
}

function parseError(type, venueId, date, message) {
  return diagnosticError({
    type,
    stage: type === "HTTP_ERROR" ? "HTTP" : "PARSE",
    provider: "hanam",
    venueId,
    targetDate: date,
    retryable: type === "HTTP_ERROR",
    message
  });
}

function logProviderResult(prefix, venueId, date, requestedTimes, availableSlots, status, reason = "") {
  const requested = requestedTimes.length === 1 ? requestedTimes[0].replace("~", "-") : `${requestedTimes[0]?.split("~")[0] || "-"}-${requestedTimes.at(-1)?.split("~")[1] || "-"}`;
  console.info(`[${prefix}] venue=${venueId} date=${date} requested=${requested} availableSlots=${availableSlots} status=${status}${reason ? ` reason=${reason}` : ""}`);
}

export const hanamProvider = {
  ...PROVIDERS.hanam,
  reservationUrl: HANAM_BASE_URL
};
