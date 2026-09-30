import { VENUES } from "../constants.js";
import { diagnosticError } from "../diagnostics.js";
import { myeonmokSlots } from "../../public/myeonmokSlots.js";

const venueId = "myeonmok";
const metaKey = Symbol.for("tennis.checkMeta");
const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
const fail = (type, message) => diagnosticError({provider: "jungnang", venueId, stage: "PARSE", type, message, retryable: false});

export function parseMyeonmokHtml(html, targetDates = []) {
  const calendar = String(html).match(/<div\s+class=['"]calendar1_table['"][^>]*>([\s\S]*?)(?=<div\s+class=["']anker-wrap|$)/i)?.[1];
  const today = String(html).match(/오늘은[\s\S]*?(20\d{2}-\d{2}-\d{2})/)?.[1];
  if (!calendar || !today || !myeonmokSlots(today).length) {
    throw fail(/<form[^>]*(?:login|flogin)|<title>[^<]*로그인/i.test(html) ? "LOGIN_OR_PROTECTION_PAGE" : "PARSE_FAILED", "면목 공개 달력과 기준 날짜를 확인하지 못했습니다.");
  }
  const guide = readSeasonalGuide(html);
  const items = [];
  const seenDates = new Set();
  let previousDate = null;
  let recognized = 0;
  for (const cell of calendar.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    const md = clean(cell[1].match(/<h6\b[^>]*>([\s\S]*?)<\/h6>/i)?.[1]).match(/^(\d{2})\.(\d{2})$/);
    if (!md) continue;
    // Calendar starts in the current week and spans consecutive dates.
    let date;
    if (!previousDate) {
      const base = new Date(today + "T00:00:00Z");
      for (let offset = -6; offset <= 0; offset++) {
        const candidate = new Date(base.getTime() + offset * 86400000).toISOString().slice(0, 10);
        if (candidate.slice(5) === md[1] + "-" + md[2]) date = candidate;
      }
    } else {
      date = new Date(Date.parse(previousDate + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
      if (date.slice(5) !== md[1] + "-" + md[2]) date = null;
    }
    if (!date) throw fail("PARSE_FAILED", "면목 달력 날짜 순서가 변경되었습니다.");
    previousDate = date;
    seenDates.add(date);
    const expectedSlots = myeonmokSlots(date);
    const slots = guide ? (Number(date.slice(5, 7)) >= 4 && Number(date.slice(5, 7)) <= 9 ? guide.summer : guide.winter) : expectedSlots;
    const parsedParts = new Map();
    const holiday = /휴장/.test(clean(cell[1]));
    for (const li of cell[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = clean(li[1]);
      if (!text) continue;
      const part = Number(text.match(/^(\d+)부/)?.[1]);
      if (!part && holiday) continue;
      if (!part || part > slots.length || parsedParts.has(part)) throw fail("PARSE_FAILED", "면목 회차 구조 또는 계절별 시간표 확인이 필요합니다: " + text);
      const status = text.match(/예약가능|예약완료|예약불가|휴장|미오픈/)?.[0] || "상태 확인 불가";
      const count = text.match(/\((\d+)\s*\/\s*(\d+)\)/);
      const bookedCount = count ? Number(count[1]) : null;
      const capacity = count ? Number(count[2]) : null;
      if (count && (capacity <= 0 || bookedCount > capacity)) throw fail("PARSE_FAILED", "면목 예약 수/정원이 잘못되었습니다.");
      if (status === "예약가능" && !count) throw fail("PARSE_FAILED", "면목 예약가능 회차의 예약 수/정원이 누락되었습니다.");
      const explicitTime = text.match(/\d{2}:\d{2}\s*~\s*\d{2}:\d{2}/)?.[0]?.replace(/\s/g, "");
      const time = explicitTime || slots[part - 1];
      const warning = (explicitTime && explicitTime !== slots[part - 1]) || time !== expectedSlots[part - 1] ? "공식 이용시간과 안내표 불일치: 확인 필요" : null;
      if (status !== "상태 확인 불가") recognized++;
      parsedParts.set(part, {
        status, rawStatus: text, bookedCount, capacity,
        availableCount: count ? capacity - bookedCount : status === "예약완료" ? 0 : null,
        available: status === "예약가능" ? capacity > bookedCount : status === "상태 확인 불가" ? null : false,
        time, warning,
        bookingMode: /fn_wait_rent_odchk1/.test(li[1]) ? "대기 신청 경로" : /fn_rent_odchk1/.test(li[1]) ? "일반 신청 경로" : null
      });
    }
    for (let i = 0; i < slots.length; i++) {
      items.push(makeItem(date, i + 1, parsedParts.get(i + 1) || {
        time: slots[i], status: holiday ? "휴장" : "조회 범위 밖 또는 상태 확인 불가",
        available: holiday ? false : null, availableCount: null
      }));
    }
  }
  if (!seenDates.size || !recognized && !items.some(item => item.status === "휴장")) {
    throw fail("PARSE_FAILED", "면목 달력에서 예약 상태를 확인하지 못했습니다.");
  }
  for (const date of new Set(targetDates)) {
    if (!myeonmokSlots(date).length) throw fail("PARSE_FAILED", "잘못된 이용 날짜");
    if (!seenDates.has(date)) myeonmokSlots(date).forEach((time, i) => items.push(makeItem(date, i + 1, {
      time, status: "조회 범위 밖 또는 상태 확인 불가", available: null, availableCount: null
    })));
  }
  const needed = new Set(targetDates);
  return items.filter(item => !needed.size || needed.has(item.date))
    .sort((a,b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}
function readSeasonalGuide(html) {
  const table = String(html).match(/<caption>세부이용시간<\/caption>([\s\S]*?)<\/table>/)?.[1];
  if (!table) return null;
  const summer = [], winter = [];
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => clean(cell[1]));
    if (!/^\d부$/.test(cells[0] || "")) continue;
    if (Number(cells[0][0]) !== summer.length + 1 || !/^\d{2}:\d{2}~\d{2}:\d{2}$/.test(cells[1])) throw fail("PARSE_FAILED", "면목 공식 운영시간표 구조 변경");
    summer.push(cells[1]);
    if (cells[2] === "미운영") continue;
    if (!/^\d{2}:\d{2}~\d{2}:\d{2}$/.test(cells[2])) throw fail("PARSE_FAILED", "면목 공식 겨울 운영시간표 구조 변경");
    winter.push(cells[2]);
  }
  if (summer.length !== 6 || winter.length !== 5) throw fail("PARSE_FAILED", "면목 공식 회차 수 변경: 확인 필요");
  return { summer, winter };
}
function makeItem(date, part, info) {
  const [startTime, endTime] = info.time.split("~");
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return {provider: "jungnang", venue: venueId, venueName: VENUES[venueId].name,
    date, part, startTime, endTime, durationMinutes: minutes(endTime) - minutes(startTime),
    url: VENUES[venueId].publicUrl, timeSource: info.warning || info.rawStatus?.match(/\d{2}:\d{2}/) ? "공식 응답" : "공식 계절별 안내표",
    ...info};
}
export async function checkMyeonmokVenues(venueIds, {venueDates = {}, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  if (!venueIds.includes(venueId)) return {};
  try {
    let html;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetchImpl(VENUES[venueId].url, {signal: AbortSignal.timeout(12000)});
        if (/\/bbs\/login\.php/.test(response.url || "")) throw fail("LOGIN_OR_PROTECTION_PAGE", "면목 로그인 페이지로 이동했습니다.");
        if (!response.ok) {
          const error = new Error("면목 HTTP " + response.status);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        const contentType = response.headers.get("content-type") || "";
        if (!/text\/html/i.test(contentType) || /charset=(?!utf-8)[^;\s]+/i.test(contentType)) throw fail("PARSE_FAILED", "면목 응답 형식/인코딩 변경: " + contentType);
        html = await response.text();
        break;
      } catch(error) {
        if (error.type || error.retryable === false || attempt === 1) throw error;
        await sleep(750);
      }
    }
    return {[venueId]: parseMyeonmokHtml(html, venueDates[venueId] || [])};
  } catch (error) {
    const result = {};
    Object.defineProperty(result, metaKey, {value: {errors: [{
      provider: "jungnang", venueId, venueName: VENUES[venueId].name,
      type: error.type || (/timeout/i.test(error.name) ? "TIMEOUT" : "NETWORK_ERROR"),
      stage: error.stage || "HTTP", message: error.message, retryable: !error.type,
      targetDate: (venueDates[venueId] || []).join(", ")
    }]}});
    return result;
  }
}
