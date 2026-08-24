import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, assertOlympicLoginConfig } from "../config.js";
import { OLYMPIC_HOME_URL, OLYMPIC_RESERVATION_URL, PROVIDERS, VENUES } from "../constants.js";

const SESSION_DIR = path.resolve(config.sessionDir, "olympic-profile");
let olympicSessionPromise = null;
let olympicSession = null;
let olympicLoginPromise = null;

const DATE_LOOKUP_STATES = {
  DATE_NOT_FOUND: "DATE_NOT_FOUND",
  AVAILABLE_COUNT_ZERO: "AVAILABLE_COUNT_ZERO",
  FOUND: "FOUND"
};

export const COURT_TYPES = {
  indoor: "실내",
  outdoor: "실외"
};

export const olympicProvider = {
  ...PROVIDERS.olympic,
  venue: "olympic",
  venueName: VENUES.olympic.name,
  reservationUrl: OLYMPIC_RESERVATION_URL
};

export async function openOlympicSession(options = {}) {
  if (olympicSession && !olympicSession.page.isClosed()) {
    return { ...olympicSession, sessionSource: "existing" };
  }
  if (olympicSessionPromise) return olympicSessionPromise;

  olympicSessionPromise = createOlympicSession(options);
  try {
    return await olympicSessionPromise;
  } finally {
    olympicSessionPromise = null;
  }
}

async function createOlympicSession(options = {}) {
  await mkdir(SESSION_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: options.headless ?? config.headless,
    viewport: { width: 1365, height: 900 },
    locale: "ko-KR"
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20_000);
  const originalClose = context.close.bind(context);
  context.close = async (...args) => {
    try {
      return await originalClose(...args);
    } finally {
      if (olympicSession?.context === context) olympicSession = null;
    }
  };
  olympicSession = { context, page };
  return { ...olympicSession, sessionSource: "restored" };
}

export async function closeOlympicSession() {
  if (!olympicSession) return;
  await olympicSession.context.close();
}

export async function isOlympicLoggedIn(page) {
  await page.goto(OLYMPIC_HOME_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (isOlympicDuplicateSessionText(body)) return false;
  return /로그아웃|마이페이지|신청내역/.test(body) && !/통합회원\s*ID로그인/.test(body);
}

export async function ensureOlympicLoggedIn(page) {
  if (olympicLoginPromise) return olympicLoginPromise;
  olympicLoginPromise = ensureOlympicLoggedInOnce(page);
  try {
    return await olympicLoginPromise;
  } finally {
    olympicLoginPromise = null;
  }
}

async function ensureOlympicLoggedInOnce(page) {
  console.info("[Olympic]");
  console.info("provider lock: acquired");
  if (await isOlympicLoggedIn(page)) {
    await openOlympicReservationPage(page).catch(() => {});
    if (!/\/sso\/usr\/login\/view/.test(page.url())) {
      console.info("session source: existing");
      console.info("login required: no");
      console.info("duplicate login detected: no");
      return true;
    }
  }

  console.info("session source: restored");
  console.info("login required: yes");
  assertOlympicLoginConfig();
  await page.goto(OLYMPIC_RESERVATION_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  await page.locator("#login_id, input[name='login_id']").first().fill(config.olympicUserId);
  await page.locator("#login_pwd, input[name='login_pwd'], input[type='password']").first().fill(config.olympicUserPassword);

  const dialogMessages = [];
  let duplicateSessionDetected = false;
  page.once("dialog", async (dialog) => {
    const message = dialog.message();
    dialogMessages.push(message);
    if (isOlympicDuplicateSessionText(message)) duplicateSessionDetected = true;
    await dialog.dismiss().catch(() => {});
  });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {}),
    page.locator("button:has-text('로그인'), .btn_login").first().click()
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (duplicateSessionDetected || isOlympicDuplicateSessionText(body)) {
    console.warn("Olympic duplicate session detected.");
    console.warn("Automatic session takeover skipped.");
    console.info("duplicate login detected: yes");
    throw new OlympicDuplicateSessionError();
  }

  await openOlympicReservationPage(page).catch(() => {});

  const loggedIn = await isOlympicLoggedIn(page) && !/\/sso\/usr\/login\/view/.test(page.url());
  if (!loggedIn && dialogMessages.length > 0) {
    throw new Error(`Olympic login failed: ${dialogMessages.at(-1)}`);
  }
  console.info("session source: new-login");
  console.info("duplicate login detected: no");
  return loggedIn;
}

export async function getAuthenticatedOlympicPage(options = {}) {
  const session = await openOlympicSession(options);
  console.info("[Olympic]");
  console.info(`session source: ${session.sessionSource}`);
  const loggedIn = await ensureOlympicLoggedIn(session.page);
  if (!loggedIn) throw new Error("Olympic login failed.");
  return session.page;
}

export async function openOlympicReservationPage(page) {
  await page.goto(OLYMPIC_HOME_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const reservationLink = page.locator("a.btn_app:visible, a[href*='resrvtn_aplictn.do']:visible").filter({ hasText: /예약신청|일일입장 예약신청/ }).first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {}),
    reservationLink.click()
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await waitForOlympicCalendar(page).catch(() => {});
}

export async function selectCourtType(page, courtType) {
  const label = COURT_TYPES[courtType];
  if (!label) throw new Error(`Unknown Olympic court type: ${courtType}`);

  await page.evaluate((targetText) => {
    const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
    const controls = Array.from(document.querySelectorAll("button, a, label, input[type='radio'], input[type='checkbox']"));
    const target = controls.find((element) => {
      const id = element.id;
      const labelFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const text = normalize(`${element.innerText || element.value || ""} ${element.title || ""} ${labelFor?.innerText || ""}`);
      return text.includes(targetText);
    });
    if (target) (target.querySelector("input") || target).click();
  }, label);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

export async function selectDate(page, date) {
  const clicked = await page.evaluate(({ isoDate }) => {
    const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
    const parsePeriod = (text) => {
      const full = normalize(text).match(/(20\d{2})\s*\.\s*([01]?\d)\s*\.\s*([0-3]?\d)\s*~\s*(?:(20\d{2})\s*\.\s*)?([01]?\d)\s*\.\s*([0-3]?\d)/);
      if (!full) return null;
      const pad = (value) => String(value).padStart(2, "0");
      const startYear = full[1];
      const endYear = full[4] || startYear;
      return {
        startDate: `${startYear}-${pad(full[2])}-${pad(full[3])}`,
        endDate: `${endYear}-${pad(full[5])}-${pad(full[6])}`
      };
    };
    const parseIso = (value) => {
      const [year, month, day] = value.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day));
    };
    const addDays = (value, days) => {
      const next = typeof value === "string" ? parseIso(value) : new Date(value.getTime());
      next.setUTCDate(next.getUTCDate() + days);
      return next;
    };
    const extractDay = (text) => {
      const datePrefix = normalize(text).match(/^([0-3]?\d)\b/);
      if (datePrefix) return datePrefix[1].padStart(2, "0");
      const beforeStatus = normalize(text).match(/(?:^|\D)([0-3]?\d)(?=\s*가능\s*\d+\s*건)/);
      return beforeStatus ? beforeStatus[1].padStart(2, "0") : null;
    };
    const findNextDateForDay = (startDate, endDate, day) => {
      const targetDay = Number(day);
      let cursor = parseIso(startDate);
      const end = endDate ? parseIso(endDate) : addDays(cursor, 40);
      while (cursor <= end) {
        if (cursor.getUTCDate() === targetDay) return cursor.toISOString().slice(0, 10);
        cursor = addDays(cursor, 1);
      }
      return null;
    };
    const dateInput = document.querySelector("input[type='date']");
    if (dateInput) {
      dateInput.value = isoDate;
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    const root = Array.from(document.querySelectorAll(".online_area .app_type .cate_con, .online_area, .app_type, section, article, main, body"))
      .find((element) => /가능\s*\d+\s*건/.test(normalize(element.innerText || element.textContent || ""))) || document.body;
    const period = parsePeriod(document.body.innerText || "");
    let cursor = period?.startDate || isoDate.slice(0, 8) + "01";
    const candidates = Array.from(root.querySelectorAll("li, td")).filter((element) => {
      const text = normalize(element.innerText || element.textContent || "");
      return /가능\s*\d+\s*건/.test(text) && /진행\s*\d+\s*건/.test(text) && /마감\s*\d+\s*건/.test(text);
    });

    let target = null;
    for (const element of candidates) {
      const text = normalize(element.innerText || element.textContent || "");
      const day = extractDay(text);
      const cellDate = day && cursor ? findNextDateForDay(cursor, period?.endDate, day) : null;
      if (cellDate === isoDate) {
        const possibleCount = Number.parseInt(text.match(/가능\s*(\d+)\s*건/)?.[1] || "0", 10);
        target = possibleCount > 0 ? element : null;
        break;
      }
      if (cellDate) cursor = addDays(cellDate, 1).toISOString().slice(0, 10);
    }

    if (!target) return false;

    const possibleButton = target.querySelector("a, button, input");
    if (!possibleButton) return false;
    possibleButton.click();
    return true;
  }, { isoDate: date });

  if (!clicked) throw new Error(`Olympic date selector not found for ${date}`);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForFunction(() => /[0-2]?\d\s*시|[0-2]?\d:00\s*~/.test(document.body.innerText || ""), null, { timeout: 10_000 }).catch(() => {});
}

export async function parseOlympicDateStatuses(page, fallbackYear = new Date().getFullYear()) {
  const snapshot = await readOlympicCalendar(page);
  return snapshot.cells.map(({ element, ...cell }) => cell);
}

export async function readOlympicCalendar(page, fallbackYear = new Date().getFullYear()) {
  await waitForOlympicCalendar(page).catch(() => {});
  const raw = await page.evaluate(() => {
    const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
    const root = Array.from(document.querySelectorAll(".online_area .app_type .cate_con, .online_area, .app_type, section, article, main, body"))
      .find((element) => /가능\s*\d+\s*건/.test(normalize(element.innerText || element.textContent || ""))) || document.body;
    const rawCells = Array.from(root.querySelectorAll("li, td")).filter((element) => {
      const text = normalize(element.innerText || element.textContent || "");
      return /가능\s*\d+\s*건/.test(text) && /진행\s*\d+\s*건/.test(text) && /마감\s*\d+\s*건/.test(text);
    }).map((element) => ({
      text: normalize(element.innerText || element.textContent || "")
    }));

    return {
      pageText: document.body.innerText || "",
      rawCells
    };
  });
  const period = parseOlympicCalendarPeriodText(raw.pageText, fallbackYear);
  const cells = buildOlympicCalendarCells(raw.rawCells, { period, fallbackYear });
  return {
    periodText: period?.text || "",
    period,
    cells
  };
}

export async function waitForOlympicCalendar(page) {
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return /20\d{2}\.\d{1,2}\.\d{1,2}\s*~/.test(text) || /가능\s*\d+\s*건/.test(text);
  }, null, { timeout: 15_000 });
}

export async function parseOlympicTimeSlots(page, date, courtType) {
  const rows = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("button, a, label, li, td, div, span"));
    return elements.map((element) => ({
      text: (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim(),
      className: String(element.className || ""),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      title: element.getAttribute("title") || "",
      dataState: element.getAttribute("data-state") || element.getAttribute("data-status") || "",
      tagName: element.tagName
    })).filter((item) => /[0-2]?\d:00\s*~\s*[0-2]?\d:00/.test(item.text));
  });

  return parseOlympicTimeSlotElements(rows, { date, courtType });
}

export async function selectTimeSlot(page, slot) {
  const clicked = await page.evaluate(({ startTime, endTime }) => {
    const compact = `${startTime}~${endTime}`.replace(/\s+/g, "");
    const candidates = Array.from(document.querySelectorAll("button, a, label, li, td, div"));
    const target = candidates.find((element) => {
      const text = (element.innerText || element.textContent || "").replace(/\s+/g, "");
      return text.includes(compact) && /신청가능|가능|선택/.test(text);
    });
    if (!target) return false;
    (target.querySelector("button, a, input") || target).click();
    return true;
  }, slot);

  if (!clicked) return false;
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit']"));
    const confirm = buttons.find((button) => /확인/.test(button.innerText || button.value || button.title || ""));
    if (confirm) confirm.click();
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  return true;
}

export async function parseAvailableOlympicCourts(page, base) {
  const elements = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button, a, label, input, li, span, div"));
    return nodes.map((element) => ({
      text: (element.innerText || element.textContent || element.value || "").replace(/\s+/g, " ").trim(),
      className: String(element.className || ""),
      disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
      title: element.getAttribute("title") || "",
      ariaLabel: element.getAttribute("aria-label") || "",
      dataState: element.getAttribute("data-state") || element.getAttribute("data-status") || "",
      tagName: element.tagName
    }));
  });
  return parseOlympicCourtElements(elements, base);
}

export function parseOlympicTimeSlotElements(elements, base) {
  const byKey = new Map();
  for (const element of elements) {
    const text = `${element.text || ""} ${element.title || ""}`.replace(/\s+/g, " ").trim();
    const match = text.match(/([0-2]?\d):00\s*~\s*([0-2]?\d):00/);
    if (!match) continue;
    const startTime = `${match[1].padStart(2, "0")}:00`;
    const endTime = `${match[2].padStart(2, "0")}:00`;
    const statusText = `${text} ${element.className || ""} ${element.dataState || ""}`;
    const available = !element.disabled && /신청가능|예약가능|가능/.test(statusText) && !/신청마감|예약마감|마감|선택불가|disabled|disable|closed|soldout/.test(statusText);
    const key = `${startTime}|${endTime}`;
    if (!byKey.has(key) || available) {
      byKey.set(key, {
        provider: "olympic",
        venue: "olympic",
        venueName: VENUES.olympic.name,
        courtType: base.courtType,
        courtTypeName: COURT_TYPES[base.courtType],
        date: base.date,
        startTime,
        endTime,
        time: `${startTime}~${endTime}`,
        durationMinutes: minutesBetween(startTime, endTime),
        available
      });
    }
  }
  return Array.from(byKey.values()).sort(compareOlympicSlots);
}

export function parseOlympicCourtElements(elements, base) {
  const byCourt = new Map();
  for (const element of elements) {
    const text = `${element.text || ""} ${element.title || ""} ${element.ariaLabel || ""}`.replace(/\s+/g, " ").trim();
    const court = text.match(/(?:^|\D)([1-9]|1\d|2\d)(?:번\s*코트|코트|번)?(?:\D|$)/)?.[1];
    if (!court) continue;
    const statusText = `${text} ${element.className || ""} ${element.dataState || ""}`;
    const unavailable = element.disabled || /신청마감|예약마감|마감|선택불가|사용불가|disabled|disable|closed|soldout|impossible|off/.test(statusText);
    const available = /신청가능|예약가능|가능|선택가능|available|on|active/.test(statusText) && !unavailable;
    if (!available) continue;

    byCourt.set(court, {
      provider: "olympic",
      venue: "olympic",
      venueName: VENUES.olympic.name,
      courtType: base.courtType,
      courtTypeName: COURT_TYPES[base.courtType],
      courtNo: court,
      date: base.date,
      startTime: base.startTime,
      endTime: base.endTime,
      time: `${base.startTime}~${base.endTime}`,
      durationMinutes: minutesBetween(base.startTime, base.endTime),
      available: true
    });
  }
  return Array.from(byCourt.values()).sort(compareOlympicSlots);
}

export function findContinuousAvailability(slots, options = {}) {
  const minimumDurationMinutes = options.minimumDurationMinutes ?? 120;
  const availableSlots = slots.filter((slot) => slot.provider === "olympic" && slot.available && slot.courtNo);
  const byCourtDate = new Map();

  for (const slot of availableSlots) {
    const key = `${slot.courtType}|${slot.courtNo}|${slot.date}`;
    if (!byCourtDate.has(key)) byCourtDate.set(key, []);
    byCourtDate.get(key).push(slot);
  }

  const results = [];
  for (const group of byCourtDate.values()) {
    const sorted = group.slice().sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    for (let startIndex = 0; startIndex < sorted.length; startIndex += 1) {
      if (minimumDurationMinutes <= sorted[startIndex].durationMinutes) {
        results.push({ ...sorted[startIndex], segments: [`${sorted[startIndex].startTime}~${sorted[startIndex].endTime}`] });
        continue;
      }

      const chain = [sorted[startIndex]];
      let endTime = sorted[startIndex].endTime;
      for (let nextIndex = startIndex + 1; nextIndex < sorted.length; nextIndex += 1) {
        if (sorted[nextIndex].startTime !== endTime) break;
        chain.push(sorted[nextIndex]);
        endTime = sorted[nextIndex].endTime;
        const durationMinutes = minutesBetween(chain[0].startTime, endTime);
        if (durationMinutes >= minimumDurationMinutes) {
          results.push({
            ...chain[0],
            endTime,
            time: `${chain[0].startTime}~${endTime}`,
            durationMinutes,
            segments: chain.map((slot) => `${slot.startTime}~${slot.endTime}`)
          });
          break;
        }
      }
    }
  }

  return uniqueOlympicSlots(results).sort(compareOlympicSlots);
}

export function filterOlympicSlotsByWatch(slots, watch) {
  const wantedTimes = new Set(watch.times || []);
  const candidates = slots.filter((slot) => slot.available && slot.courtNo);

  return candidates.filter((slot) => (
    slot.date === watch.date &&
    selectedByWatchTimes(slot, wantedTimes)
  ));
}

export async function fetchOlympicAvailabilityForDate(page, { date, courtType }) {
  await openOlympicReservationPage(page);
  await selectCourtType(page, courtType);

  const calendar = await readOlympicCalendar(page);
  const dateStatus = findOlympicDateStatus(calendar, date);
  if (!dateStatus) {
    throw new OlympicDateLookupError(date, calendar);
  }
  if (dateStatus.possibleCount === 0) {
    return { lookupStatus: DATE_LOOKUP_STATES.AVAILABLE_COUNT_ZERO, calendar, dateStatus, timeSlots: [], slots: [] };
  }

  await selectDate(page, date);

  const timeSlots = (await parseOlympicTimeSlots(page, date, courtType)).filter((slot) => slot.available);
  const slots = [];
  for (const timeSlot of timeSlots) {
    const selected = await selectTimeSlot(page, timeSlot);
    if (!selected) continue;
    const courts = await parseAvailableOlympicCourts(page, timeSlot);
    slots.push(...courts);
  }

  return { lookupStatus: DATE_LOOKUP_STATES.FOUND, calendar, dateStatus, timeSlots, slots: uniqueOlympicSlots(slots) };
}

export async function checkOlympicByWatches(watches) {
  const olympicWatches = watches.filter(isOlympicWatch);
  if (olympicWatches.length === 0) return [];

  const groups = new Map();
  for (const watch of olympicWatches) {
    for (const courtType of Object.keys(COURT_TYPES)) {
      const key = `${courtType}|${watch.date}`;
      if (!groups.has(key)) groups.set(key, { date: watch.date, courtType });
    }
  }

  try {
    const page = await getAuthenticatedOlympicPage();

    const allSlots = [];
    const failedDateLookups = new Set();
    for (const group of groups.values()) {
      if (failedDateLookups.has(group.date)) continue;
      try {
        const result = await fetchOlympicAvailabilityForDate(page, group);
        allSlots.push(...result.slots);
      } catch (error) {
        if (!(error instanceof OlympicDateLookupError)) throw error;
        failedDateLookups.add(group.date);
        console.warn("[Olympic]");
        console.warn(`${group.date} date lookup failed`);
        console.warn("next retry: next scheduled check");
      }
    }
    return uniqueOlympicSlots(allSlots);
  } catch (error) {
    if (error instanceof OlympicDuplicateSessionError) return [];
    throw error;
  }
}

export async function inspectOlympicReservationPage(page) {
  const requests = [];
  page.on("request", (request) => {
    if (/ksponco|kspo/.test(request.url())) requests.push({ method: request.method(), url: request.url() });
  });
  await openOlympicReservationPage(page);
  const snapshot = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: (document.body.innerText || "").slice(0, 4000),
    controls: Array.from(document.querySelectorAll("button, a, input, select, label")).slice(0, 160).map((element) => ({
      tag: element.tagName,
      type: element.type || "",
      name: element.name || "",
      id: element.id || "",
      className: String(element.className || ""),
      text: (element.innerText || element.value || element.title || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
      href: element.href || ""
    })),
    scripts: Array.from(document.scripts).map((script) => script.src).filter(Boolean)
  }));
  return { ...snapshot, requests };
}

export function isOlympicWatch(watch) {
  return watch.provider === "olympic" || watch.venue === "olympic" || watch.venues?.includes("olympic");
}

export function olympicKeyFor(item) {
  return `olympic|${item.courtType}|${item.courtNo}|${item.date}|${item.startTime}|${item.endTime}`;
}

export class OlympicDateLookupError extends Error {
  constructor(date, calendar) {
    super(`Olympic date selector not found for ${date}`);
    this.name = "OlympicDateLookupError";
    this.code = DATE_LOOKUP_STATES.DATE_NOT_FOUND;
    this.date = date;
    this.calendar = calendar;
  }
}

export class OlympicDuplicateSessionError extends Error {
  constructor() {
    super("Olympic duplicate session detected. Automatic session takeover skipped.");
    this.name = "OlympicDuplicateSessionError";
    this.code = "OLYMPIC_DUPLICATE_SESSION";
  }
}

export function isOlympicDuplicateSessionText(text) {
  return /현재\s*IP에서\s*접속중인\s*계정|현재\s*접속중인\s*계정|이전\s*접속을\s*종료하고\s*계속\s*진행/.test(text || "");
}

export function parseOlympicCalendarPeriodText(text, fallbackYear = new Date().getFullYear()) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  const full = normalized.match(/(20\d{2})\s*\.\s*([01]?\d)\s*\.\s*([0-3]?\d)\s*~\s*(?:(20\d{2})\s*\.\s*)?([01]?\d)\s*\.\s*([0-3]?\d)/);
  if (full) {
    const startYear = full[1];
    const endYear = full[4] || startYear;
    return {
      text: `${toIsoDate(startYear, full[2], full[3]).replaceAll("-", ".")} ~ ${toIsoDate(endYear, full[5], full[6]).replaceAll("-", ".")}`,
      startDate: toIsoDate(startYear, full[2], full[3]),
      endDate: toIsoDate(endYear, full[5], full[6])
    };
  }

  const yearMonth = normalized.match(/(20\d{2})\s*[년./-]?\s*([01]?\d)\s*월?/);
  if (!yearMonth) return null;
  return {
    text: `${yearMonth[1]}.${String(yearMonth[2]).padStart(2, "0")}`,
    startDate: toIsoDate(yearMonth[1] || fallbackYear, yearMonth[2], 1),
    endDate: null
  };
}

export function buildOlympicCalendarCells(rawCells, options = {}) {
  const period = options.period || null;
  const fallbackYear = options.fallbackYear || new Date().getFullYear();
  const cells = [];
  let cursor = period?.startDate || null;
  let fallbackYearMonth = period?.startDate?.slice(0, 7) || `${fallbackYear}-${String(options.fallbackMonth || new Date().getMonth() + 1).padStart(2, "0")}`;

  for (const raw of rawCells) {
    const rawText = normalizeText(raw.text);
    const day = extractOlympicCellDay(rawText);
    if (!day) continue;

    const date = cursor
      ? findNextDateForDay(cursor, period?.endDate, day)
      : dateFromYearMonthAndDay(fallbackYearMonth, day);
    if (!date) continue;

    cells.push({
      date,
      day,
      possibleCount: parseStatusCount(rawText, "가능"),
      pendingCount: parseStatusCount(rawText, "진행"),
      closedCount: parseStatusCount(rawText, "마감"),
      rawText
    });

    cursor = addDays(date, 1);
    if (!period?.startDate && Number(day) >= 28) {
      fallbackYearMonth = addMonthIfNextDayFallsBack(fallbackYearMonth, day, rawCells[cells.length]?.text);
    }
  }

  return cells;
}

export function findOlympicDateStatus(calendar, date) {
  return calendar?.cells?.find((item) => item.date === date) || null;
}

function extractOlympicCellDay(text) {
  const normalized = normalizeText(text);
  const datePrefix = normalized.match(/^([0-3]?\d)\b/);
  if (datePrefix) return datePrefix[1].padStart(2, "0");
  const beforeStatus = normalized.match(/(?:^|\D)([0-3]?\d)(?=\s*가능\s*\d+\s*건)/);
  return beforeStatus ? beforeStatus[1].padStart(2, "0") : null;
}

function parseStatusCount(text, label) {
  const match = text.match(new RegExp(`${label}\\s*(\\d+)\\s*건`));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function toIsoDate(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}

function dateFromYearMonthAndDay(yearMonth, day) {
  const [year, month] = yearMonth.split("-").map(Number);
  return toIsoDate(year, month, day);
}

function findNextDateForDay(startDate, endDate, day) {
  const targetDay = Number(day);
  let cursor = parseIsoDate(startDate);
  const end = endDate ? parseIsoDate(endDate) : addDaysAsDate(cursor, 40);
  while (cursor <= end) {
    if (cursor.getUTCDate() === targetDay) return cursor.toISOString().slice(0, 10);
    cursor = addDaysAsDate(cursor, 1);
  }
  return null;
}

function parseIsoDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, days) {
  return addDaysAsDate(parseIsoDate(date), days).toISOString().slice(0, 10);
}

function addDaysAsDate(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthIfNextDayFallsBack(yearMonth, currentDay, nextText) {
  const nextDay = extractOlympicCellDay(nextText || "");
  if (!nextDay || Number(nextDay) >= Number(currentDay)) return yearMonth;
  const [year, month] = yearMonth.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 7);
}

function uniqueOlympicSlots(slots) {
  return Array.from(new Map(slots.map((slot) => [olympicKeyFor(slot), slot])).values());
}

function compareOlympicSlots(a, b) {
  const head = `${a.date} ${a.courtType} ${a.startTime}`.localeCompare(`${b.date} ${b.courtType} ${b.startTime}`);
  if (head !== 0) return head;
  return Number(a.courtNo || 0) - Number(b.courtNo || 0);
}

function toMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesBetween(startTime, endTime) {
  return toMinutes(endTime) - toMinutes(startTime);
}

function selectedByWatchTimes(slot, wantedTimes) {
  if (wantedTimes.size === 0) return false;
  if (!slot.segments) return wantedTimes.has(slot.time);
  return slot.segments.every((segment) => wantedTimes.has(segment));
}
