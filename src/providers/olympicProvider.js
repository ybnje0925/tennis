import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, assertOlympicLoginConfig } from "../config.js";
import { OLYMPIC_HOME_URL, OLYMPIC_RESERVATION_URL, PROVIDERS, VENUES } from "../constants.js";

const SESSION_DIR = path.resolve(config.sessionDir, "olympic-profile");

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
  await mkdir(SESSION_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: options.headless ?? config.headless,
    viewport: { width: 1365, height: 900 },
    locale: "ko-KR"
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20_000);
  return { context, page };
}

export async function isOlympicLoggedIn(page) {
  await page.goto(OLYMPIC_HOME_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return /로그아웃|마이페이지|신청내역/.test(body) && !/통합회원\s*ID로그인/.test(body);
}

export async function ensureOlympicLoggedIn(page) {
  if (await isOlympicLoggedIn(page)) return true;

  assertOlympicLoginConfig();
  await page.goto(OLYMPIC_RESERVATION_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  await page.locator("#login_id, input[name='login_id']").first().fill(config.olympicUserId);
  await page.locator("#login_pwd, input[name='login_pwd'], input[type='password']").first().fill(config.olympicUserPassword);

  const dialogMessages = [];
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    if (/접속중|계속 진행/.test(dialog.message())) await dialog.accept();
    else await dialog.dismiss().catch(() => {});
  });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => {}),
    page.locator("button:has-text('로그인'), .btn_login").first().click()
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.goto(OLYMPIC_RESERVATION_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const loggedIn = !/\/sso\/usr\/login\/view/.test(page.url());
  if (!loggedIn && dialogMessages.length > 0) {
    throw new Error(`Olympic login failed: ${dialogMessages.at(-1)}`);
  }
  return loggedIn;
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
  const day = Number(date.slice(8, 10));
  const clicked = await page.evaluate(({ isoDate, dayText }) => {
    const normalize = (text) => (text || "").replace(/\s+/g, " ").trim();
    const dateInput = document.querySelector("input[type='date']");
    if (dateInput) {
      dateInput.value = isoDate;
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    const candidates = Array.from(document.querySelectorAll("td, button, a, label"));
    const target = candidates.find((element) => {
      const text = normalize(`${element.innerText || element.textContent || ""} ${element.title || ""} ${element.getAttribute("aria-label") || ""}`);
      return new RegExp(`(^|\\D)${dayText}(\\D|$)`).test(text) && /가능|진행|마감|예약|신청|선택/.test(text);
    });
    if (!target) return false;
    (target.querySelector("button, a, input") || target).click();
    return true;
  }, { isoDate: date, dayText: String(day) });

  if (!clicked) throw new Error(`Olympic date selector not found for ${date}`);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

export async function parseOlympicDateStatuses(page, fallbackYear = new Date().getFullYear()) {
  const raw = await page.evaluate(() => {
    const pageText = document.body.innerText || "";
    const yearMonth = pageText.match(/(20\d{2})\s*[년./-]?\s*([01]?\d)\s*월?/);
    const cells = Array.from(document.querySelectorAll("td, li, div, a, button"));
    return {
      year: yearMonth?.[1] || "",
      month: yearMonth?.[2] || "",
      items: cells.map((cell) => ({
        text: (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim()
      })).filter((item) => /가능\s*\d+\s*건|진행\s*\d+\s*건|마감\s*\d+\s*건/.test(item.text))
    };
  });

  const year = raw.year || String(fallbackYear);
  const month = raw.month ? raw.month.padStart(2, "0") : "";
  return raw.items.flatMap(({ text }) => {
    const day = text.match(/(^|\D)([0-3]?\d)(\D|$)/)?.[2];
    if (!day || !month) return [];
    return [{
      date: `${year}-${month}-${day.padStart(2, "0")}`,
      possibleCount: parseStatusCount(text, "가능"),
      pendingCount: parseStatusCount(text, "진행"),
      closedCount: parseStatusCount(text, "마감"),
      rawText: text
    }];
  });
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
  await page.goto(OLYMPIC_RESERVATION_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await selectCourtType(page, courtType);
  await selectDate(page, date);

  const dateStatuses = await parseOlympicDateStatuses(page);
  const dateStatus = dateStatuses.find((item) => item.date === date);
  if (dateStatus?.possibleCount === 0) return { dateStatus, timeSlots: [], slots: [] };

  const timeSlots = (await parseOlympicTimeSlots(page, date, courtType)).filter((slot) => slot.available);
  const slots = [];
  for (const timeSlot of timeSlots) {
    const selected = await selectTimeSlot(page, timeSlot);
    if (!selected) continue;
    const courts = await parseAvailableOlympicCourts(page, timeSlot);
    slots.push(...courts);
  }

  return { dateStatus, timeSlots, slots: uniqueOlympicSlots(slots) };
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

  const { context, page } = await openOlympicSession();
  try {
    const loggedIn = await ensureOlympicLoggedIn(page);
    if (!loggedIn) throw new Error("Olympic login failed.");

    const allSlots = [];
    for (const group of groups.values()) {
      const result = await fetchOlympicAvailabilityForDate(page, group);
      allSlots.push(...result.slots);
    }
    return uniqueOlympicSlots(allSlots);
  } finally {
    await context.close();
  }
}

export async function inspectOlympicReservationPage(page) {
  const requests = [];
  page.on("request", (request) => {
    if (/ksponco|kspo/.test(request.url())) requests.push({ method: request.method(), url: request.url() });
  });
  await page.goto(OLYMPIC_RESERVATION_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
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

function parseStatusCount(text, label) {
  const match = text.match(new RegExp(`${label}\\s*(\\d+)\\s*건`));
  return match ? Number.parseInt(match[1], 10) : 0;
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
