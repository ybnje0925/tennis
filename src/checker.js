import { openGangdongSession, ensureLoggedIn, looksLikeProtectionOrLogin } from "./browserSession.js";
import { PROVIDERS, VENUES } from "./constants.js";
import { config } from "./config.js";
import { parseReservationDom } from "./parser.js";
import { normalizeDate } from "./normalization.js";
import { checkOlympicByWatches, isOlympicWatch } from "./providers/olympicProvider.js";
import { checkSongpaVenues, songpaVenueIdsFromWatches } from "./providers/songpaProvider.js";
import { createProviderTimer, PROVIDER_HARD_TIMEOUT_MS, withTimeout } from "./providerTiming.js";
import { CheckDiagnosticError, classifyError, diagnosticError, errorMessageForConsole } from "./diagnostics.js";
import { fileURLToPath } from "node:url";

const providerLocks = new Map();
export const CHECK_META = Symbol.for("tennis.checkMeta");

export async function checkVenue(page, venueId, options = {}) {
  const venue = VENUES[venueId];
  if (!venue) throw new Error(`Unknown venue: ${venueId}`);
  const timer = options.timer;

  await maybeStep(timer, `${venue.name} 페이지 접근`, async () => {
    await page.goto(venue.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }).catch((error) => {
    throw diagnosticError({
      type: classifyError(error, { stage: "NAVIGATION" }).type,
      stage: "NAVIGATION",
      provider: "gangdong",
      venueId,
      targetDate: options.dates?.[0] || null,
      retryable: classifyError(error).retryable,
      message: error.message,
      cause: error
    });
  });

  if (await looksLikeProtectionOrLogin(page)) {
    throw diagnosticError({
      type: "LOGIN_OR_PROTECTION_PAGE",
      stage: "AUTH_OR_PROTECTION",
      provider: "gangdong",
      venueId,
      targetDate: options.dates?.[0] || null,
      retryable: false,
      message: `${venue.name} 예약현황이 실제 달력이 아니라 로그인/보호 페이지로 보입니다.`,
      details: await inspectPageBasics(page)
    });
  }

  if (!options.dates || options.dates.length === 0) {
    const reservations = await maybeStep(timer, `${venue.name} 예약 데이터 파싱`, () => parseReservationDom(page, venueId));
    if (reservations.length === 0) {
      throw new Error(`${venue.name} 예약현황 DOM에서 예약 데이터를 찾지 못했습니다.`);
    }
    return reservations;
  }

  const datesByMonth = groupDatesByMonth(options.dates);
  const results = [];
  for (const [targetMonth, dates] of datesByMonth) {
    await maybeStep(timer, `${venue.name} 날짜 선택 ${targetMonth}`, () => moveGangdongCalendarToMonth(page, targetMonth)).catch((error) => {
      throw diagnosticError({
        type: classifyError(error, { stage: "CALENDAR" }).type,
        stage: "CALENDAR_NAVIGATION",
        provider: "gangdong",
        venueId,
        targetDate: dates[0] || null,
        retryable: classifyError(error).retryable,
        message: error.message,
        details: { targetMonth },
        cause: error
      });
    });
    const calendar = await inspectGangdongCalendar(page);
    const missingCells = dates.filter((date) => !calendar.dates.some((item) => item.date === date));
    if (missingCells.length > 0) {
      throw diagnosticError({
        type: "CALENDAR_DATE_NOT_FOUND",
        stage: "CALENDAR",
        provider: "gangdong",
        venueId,
        targetDate: missingCells.join(", "),
        retryable: false,
        message: `CALENDAR_DATE_NOT_FOUND: ${venue.name} 날짜 cell을 찾지 못했습니다 (${missingCells.join(", ")})`,
        details: {
          ...(await inspectPageBasics(page)),
          targetDates: missingCells,
          currentYearMonth: calendar.yearMonth,
          visibleDates: calendar.dates.map((item) => item.date)
        }
      });
    }

    const reservations = await maybeStep(timer, `${venue.name} 예약 데이터 파싱`, () => parseReservationDom(page, venueId)).catch((error) => {
      throw diagnosticError({
        type: "PARSE_FAILED",
        stage: "PARSE",
        provider: "gangdong",
        venueId,
        targetDate: dates[0] || null,
        retryable: false,
        message: error.message,
        cause: error
      });
    });
    const hasSlotData = dates.some((date) => {
      const inspected = calendar.dates.find((item) => item.date === date);
      return inspected?.slotElementCount > 0;
    });
    if (reservations.length === 0 && !hasSlotData) {
      for (const date of dates) {
        console.debug(`${venue.name} | ${date} | 날짜 확인 | 슬롯 미표시`);
      }
      continue;
    }
    if (reservations.length === 0) {
      throw diagnosticError({
        type: "PARSE_FAILED",
        stage: "PARSE",
        provider: "gangdong",
        venueId,
        targetDate: dates[0] || null,
        retryable: false,
        message: `${venue.name} ${targetMonth} 예약현황 DOM에서 예약 데이터를 찾지 못했습니다.`,
        details: {
          targetMonth,
          currentYearMonth: calendar.yearMonth,
          visibleDates: calendar.dates.map((item) => item.date)
        }
      });
    }

    const neededDates = new Set(dates);
    const matches = reservations.filter((item) => neededDates.has(item.date));
    const missingReservationDates = dates.filter((date) => !matches.some((item) => item.date === date));
    for (const date of missingReservationDates) {
      console.debug(`${venue.name} | ${date} | 날짜 확인 | 예약 item 없음`);
    }
    results.push(...matches);
  }
  return results;
}

async function inspectPageBasics(page) {
  const [title, bodyText] = await Promise.all([
    page.title?.().catch(() => "") || "",
    readBodyText(page)
  ]);
  const url = typeof page.url === "function" ? page.url() : "";
  return {
    url,
    title,
    redirect: /\/bbs\/login\.php|login/i.test(url),
    bodySample: String(bodyText || "").replace(/\s+/g, " ").trim().slice(0, 300)
  };
}

async function readBodyText(page) {
  try {
    const locator = page.locator?.("body");
    if (!locator) return "";
    if (typeof locator.innerText === "function") return await locator.innerText({ timeout: 3000 });
    const first = locator.first?.();
    if (typeof first?.innerText === "function") return await first.innerText({ timeout: 3000 });
    return "";
  } catch {
    return "";
  }
}

export async function inspectGangdongCalendar(page) {
  return page.evaluate(() => {
    const normalizeSpaces = (value) => (value || "").replace(/\s+/g, " ").trim();
    const headerText = normalizeSpaces(document.querySelector(".calendar1_yearmonth strong")?.textContent || "");
    const header = headerText.match(/(20\d{2})\s*\.\s*([01]?\d)/);
    if (!header) return { yearMonth: null, dates: [] };

    const yearMonth = `${header[1]}-${header[2].padStart(2, "0")}`;
    const dates = Array.from(document.querySelectorAll(".calendar1_table td")).flatMap((cell) => {
      const dayText = normalizeSpaces(cell.querySelector("h6")?.textContent || "");
      const day = dayText.match(/^([0-3]?\d)$/)?.[1];
      if (!day) return [];

      const slotElements = Array.from(cell.querySelectorAll("li"));
      return [{
        date: `${yearMonth}-${day.padStart(2, "0")}`,
        present: true,
        slotElementCount: slotElements.length,
        reservationStatusCount: slotElements.filter((item) => /예약가능|예약완료/.test(item.textContent || "")).length
      }];
    });

    return { yearMonth, dates };
  });
}

export async function getGangdongCalendarMonth(page) {
  const text = await page.locator(".calendar1_yearmonth strong").first().innerText({ timeout: 5000 });
  const match = text.replace(/\s+/g, " ").trim().match(/(20\d{2})\s*\.\s*([01]?\d)/);
  if (!match) throw new Error(`강동 달력 연월을 읽지 못했습니다: ${text}`);
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

export async function moveGangdongCalendarToMonth(page, targetMonth, options = {}) {
  const maxMoves = options.maxMoves ?? 12;
  let currentMonth = await getGangdongCalendarMonth(page);
  let distance = monthDistance(currentMonth, targetMonth);
  if (Math.abs(distance) > maxMoves) {
    throw new Error(`강동 달력 이동 범위를 초과했습니다: ${currentMonth} → ${targetMonth}`);
  }

  let moves = 0;
  while (distance !== 0) {
    if (moves >= maxMoves) {
      throw new Error(`강동 달력 이동 중단: ${currentMonth} → ${targetMonth}`);
    }
    const direction = distance > 0 ? "다음달" : "이전달";
    const link = page.locator(`.calendar1_yearmonth a:has(img[alt="${direction}"])`).first();
    const href = await link.getAttribute("href", { timeout: 5000 });
    if (!href || href.startsWith("javascript:")) {
      throw new Error(`강동 달력 ${direction} 이동 링크를 사용할 수 없습니다: ${currentMonth} → ${targetMonth}`);
    }

    const expectedMonth = addMonths(currentMonth, distance > 0 ? 1 : -1);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      link.click()
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await waitForGangdongCalendarMonth(page, expectedMonth);
    currentMonth = await getGangdongCalendarMonth(page);
    distance = monthDistance(currentMonth, targetMonth);
    moves += 1;
  }

  await waitForGangdongCalendarMonth(page, targetMonth);
}

async function waitForGangdongCalendarMonth(page, targetMonth) {
  await page.waitForFunction((month) => {
    const text = document.querySelector(".calendar1_yearmonth strong")?.textContent || "";
    const match = text.replace(/\s+/g, " ").trim().match(/(20\d{2})\s*\.\s*([01]?\d)/);
    if (!match) return false;
    return `${match[1]}-${match[2].padStart(2, "0")}` === month;
  }, targetMonth, { timeout: 10_000 });
}

export function groupDatesByMonth(dates) {
  const groups = new Map();
  for (const rawDate of dates || []) {
    const date = normalizeDate(rawDate);
    if (!date) continue;
    const month = date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, new Set());
    groups.get(month).add(date);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => monthIndex(left) - monthIndex(right))
    .map(([month, values]) => [month, Array.from(values).sort()]);
}

function monthDistance(fromMonth, toMonth) {
  return monthIndex(toMonth) - monthIndex(fromMonth);
}

function monthIndex(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber;
}

function addMonths(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + monthNumber - 1 + offset;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export async function checkGangdongVenues(venueIds, options = {}) {
  const ids = venueIds.filter((venueId) => VENUES[venueId]?.provider === "gangdong");
  if (ids.length === 0) return {};

  const timer = createProviderTimer("강동");
  let errorForTimer = null;
  let session = await timer.step("브라우저 세션", () => openGangdongSession()).catch((error) => {
    throw diagnosticError({
      type: classifyError(error, { stage: "BROWSER" }).type,
      stage: "BROWSER",
      provider: "gangdong",
      retryable: true,
      message: error.message,
      cause: error
    });
  });
  try {
    const loggedIn = await ensureLoggedIn(session.page, { timer });
    if (!loggedIn) {
      throw diagnosticError({
        type: "LOGIN_OR_PROTECTION_PAGE",
        stage: "AUTH_OR_PROTECTION",
        provider: "gangdong",
        retryable: false,
        message: "로그인 완료 여부를 확인하지 못했습니다.",
        details: await inspectPageBasics(session.page)
      });
    }

    const result = {};
    const errors = [];
    const retryVenueIds = [];
    for (const venueId of ids) {
      try {
        result[venueId] = await checkVenue(session.page, venueId, { dates: options.venueDates?.[venueId], timer });
      } catch (error) {
        const diagnostic = classifyError(error, {
          provider: "gangdong",
          venueId,
          targetDate: options.venueDates?.[venueId]?.join(", ") || null
        });
        errors.push(diagnostic);
        if (diagnostic.retryable) retryVenueIds.push(venueId);
        console.warn(`강동 조회 실패 | ${errorMessageForConsole(diagnostic)}`);
        if (diagnostic.stack) console.warn(diagnostic.stack);
      }
    }
    if (retryVenueIds.length > 0) {
      await Promise.resolve(session.context.close()).catch((error) => console.warn(`강동 브라우저 세션 종료 실패: ${error.message}`));
      await wait(options.retryDelayMs ?? 2500);
      session = await timer.step("브라우저 세션 재시도", () => openGangdongSession());
      const retryLoggedIn = await ensureLoggedIn(session.page, { timer });
      if (!retryLoggedIn) {
        const diagnostic = classifyError(new CheckDiagnosticError({
          type: "LOGIN_OR_PROTECTION_PAGE",
          stage: "AUTH_OR_PROTECTION",
          provider: "gangdong",
          retryable: false,
          message: "재시도 로그인 완료 여부를 확인하지 못했습니다."
        }));
        for (const venueId of retryVenueIds) replaceVenueError(errors, venueId, { ...diagnostic, venueId, venueName: VENUES[venueId]?.name });
      } else {
        for (const venueId of retryVenueIds) {
          try {
            result[venueId] = await checkVenue(session.page, venueId, { dates: options.venueDates?.[venueId], timer });
            removeVenueError(errors, venueId);
          } catch (error) {
            const diagnostic = classifyError(error, {
              provider: "gangdong",
              venueId,
              targetDate: options.venueDates?.[venueId]?.join(", ") || null
            });
            replaceVenueError(errors, venueId, diagnostic);
            console.warn(`강동 재시도 실패 | ${errorMessageForConsole(diagnostic)}`);
            if (diagnostic.stack) console.warn(diagnostic.stack);
          }
        }
      }
    }
    return withCheckMeta(result, { errors });
  } catch (error) {
    errorForTimer = error;
    throw error;
  } finally {
    await Promise.resolve(session?.context?.close()).catch((error) => console.warn(`강동 브라우저 세션 종료 실패: ${error.message}`));
    timer.end(errorForTimer);
  }
}

export async function checkAllVenues(options = {}) {
  const watches = options.watches || [];
  if (watches.length === 0 && options.requireWatches) return {};

  const watchedVenueIds = new Set(
    watches.length > 0
      ? watches.flatMap((watch) => watch.venues || (watch.venue ? [watch.venue] : []))
      : Object.keys(VENUES).filter((venueId) => VENUES[venueId].provider !== "olympic")
  );

  const result = {};
  const venueDates = buildVenueDateTargets(watches);
  const meta = { errors: [] };
  const olympicWatches = watches.filter(isOlympicWatch);
  const providerChecks = [
    safeProviderCheck("gangdong", () => checkGangdongVenues(Array.from(watchedVenueIds), { venueDates })),
    safeProviderCheck("songpa", () => checkSongpaVenues(songpaVenueIdsFromWatches(watches), { venueDates })),
    olympicWatches.length > 0 && config.enableOlympicProvider
      ? safeProviderCheck("olympic", () => checkOlympicByWatches(olympicWatches))
      : Promise.resolve([])
  ];
  const [gangdong, songpa, olympicResult] = await Promise.all(providerChecks);

  Object.assign(result, stripCheckMeta(gangdong));
  meta.errors.push(...getCheckErrors(gangdong));
  Object.assign(result, stripCheckMeta(songpa));
  meta.errors.push(...getCheckErrors(songpa));
  meta.errors.push(...getCheckErrors(olympicResult));
  if (olympicWatches.length > 0 && config.enableOlympicProvider && olympicResult) result.olympic = olympicResult;
  return withCheckMeta(result, meta);
}

export async function runProviderCheck(providerId, fn, options = {}) {
  if (providerLocks.has(providerId)) {
    console.debug(`${providerId} check already running; duplicate check skipped.`);
    return withCheckMeta(providerId === "olympic" ? [] : {}, {
      errors: [{ provider: providerId, stage: "SCHEDULER", type: "DUPLICATE_SKIPPED", message: "중복조회 생략", retryable: false }]
    });
  }

  const running = withTimeout(
    Promise.resolve().then(fn),
    options.timeoutMs ?? PROVIDER_HARD_TIMEOUT_MS,
    PROVIDERS[providerId]?.name || providerId,
    "provider 전체 조회"
  );
  providerLocks.set(providerId, running);
  try {
    return await running;
  } finally {
    if (providerLocks.get(providerId) === running) providerLocks.delete(providerId);
  }
}

async function safeProviderCheck(providerId, fn) {
  try {
    return await runProviderCheck(providerId, fn);
  } catch (error) {
    const diagnostic = classifyError(error, { provider: providerId });
    console.error(`${PROVIDERS[providerId]?.name || providerId} 조회 실패 | ${errorMessageForConsole(diagnostic)}`);
    if (diagnostic.stack) console.error(diagnostic.stack);
    return withCheckMeta(providerId === "olympic" ? [] : {}, {
      errors: [diagnostic]
    });
  }
}

function withCheckMeta(result, meta) {
  Object.defineProperty(result, CHECK_META, {
    value: meta,
    enumerable: false,
    configurable: true
  });
  return result;
}

function stripCheckMeta(result) {
  if (!result || typeof result !== "object") return result;
  const clone = Array.isArray(result) ? result.slice() : { ...result };
  return clone;
}

function getCheckErrors(result) {
  return result?.[CHECK_META]?.errors || [];
}

function maybeStep(timer, label, fn) {
  return timer ? timer.step(label, fn) : fn();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeVenueError(errors, venueId) {
  const index = errors.findIndex((error) => error.venueId === venueId);
  if (index >= 0) errors.splice(index, 1);
}

function replaceVenueError(errors, venueId, diagnostic) {
  removeVenueError(errors, venueId);
  errors.push(diagnostic);
}

export function buildVenueDateTargets(watches) {
  const targets = {};
  for (const watch of watches) {
    if (watch.enabled !== true) continue;
    for (const venueId of watch.venues || []) {
      const date = normalizeDate(watch.date);
      if (!date) continue;
      if (!targets[venueId]) targets[venueId] = new Set();
      targets[venueId].add(date);
    }
  }
  return Object.fromEntries(
    Object.entries(targets).map(([venueId, dates]) => [venueId, Array.from(dates).sort()])
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  checkAllVenues()
    .then((result) => {
      for (const [venueId, items] of Object.entries(result)) {
        console.log(`${VENUES[venueId].name}: ${items.length} items`);
        console.log(items.slice(0, 5));
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
