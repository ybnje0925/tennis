import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, assertSongpaLoginConfig } from "../config.js";
import { PROVIDERS, SONGPA_LOGIN_URL, TIME_SLOTS, VENUES } from "../constants.js";
import { createProviderTimer } from "../providerTiming.js";
import { CheckDiagnosticError, classifyError, diagnosticError, errorMessageForConsole } from "../diagnostics.js";
import { launchPersistentContext } from "../playwrightLauncher.js";
import { CookieSession } from "../httpSession.js";
import { parseLegacyCalendarHtml } from "../legacyHttpParser.js";

import { parseSongpaCalendarSnapshot, parseSongpaSlotText, parseSongpaCalendarHtml } from "./songpaCalendar.js";
export { parseSongpaCalendarSnapshot, parseSongpaSlotText, parseSongpaCalendarHtml } from "./songpaCalendar.js";

const SESSION_DIR = path.resolve(config.sessionDir, "songpa-profile");
const CHECK_META = Symbol.for("tennis.checkMeta");
const NAVIGATION_TIMEOUT_MS = 30_000;
const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;

export const songpaProvider = {
  ...PROVIDERS.songpa,
  reservationUrl: "https://spc.esongpa.or.kr/"
};

export function isSongpaWatch(watch) {
  return (watch.venues || []).some((venueId) => VENUES[venueId]?.provider === "songpa");
}

export async function openSongpaSession(options = {}) {
  await mkdir(SESSION_DIR, { recursive: true });
  const context = await launchPersistentContext(
    SESSION_DIR,
    {
      headless: options.headless ?? config.headless,
      viewport: { width: 1365, height: 900 },
      locale: "ko-KR"
    },
    {
      timeoutMs: BROWSER_LAUNCH_TIMEOUT_MS,
      providerLabel: "송파",
      stepLabel: "브라우저 실행"
    }
  );
  try {
    const page = context.pages()[0] || await context.newPage();
    await context.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) return route.abort();
      return route.continue();
    });
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout?.(NAVIGATION_TIMEOUT_MS);
    return { context, page };
  } catch (error) {
    await context.close().catch((closeError) => console.warn(
      '송파 브라우저 초기화 실패 후 종료 실패: ' + closeError.message
    ));
    throw error;
  }
}

export async function isSongpaLoggedIn(page) {
  await page.goto("https://spc.esongpa.or.kr/", { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return /로그아웃/.test(body);
}

export async function ensureSongpaLoggedIn(page, options = {}) {
  const timer = options.timer;
  if (await maybeStep(timer, "로그인 상태 확인", () => isSongpaLoggedIn(page))) return true;

  assertSongpaLoginConfig();
  return maybeStep(timer, "로그인", async () => {
    await page.goto(SONGPA_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    await page.locator("input[name='mb_id'], #login_id").first().fill(config.songpaUserId, { timeout: 10_000 });
    await page.locator("input[name='mb_password'], input[type='password']").first().fill(config.songpaUserPassword, { timeout: 10_000 });

    const dialogMessages = [];
    page.on("dialog", async (dialog) => {
      dialogMessages.push(dialog.message());
      await dialog.accept().catch(() => {});
    });

    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {}),
      page.locator("input[type='submit'], button[type='submit'], .btn-login").first().click({ timeout: 10_000 })
    ]);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

    const loggedIn = await isSongpaLoggedIn(page);
    if (!loggedIn && dialogMessages.length > 0) {
      throw new Error(`Songpa login failed: ${dialogMessages.at(-1)}`);
    }
    return loggedIn;
  });
}

export async function checkSongpaVenues(venueIds, options = {}) {
  if (config.songpaHttpEnabled) {
    try {
      return await checkSongpaVenuesHttp(venueIds, options);
    } catch (error) {
      console.warn(`송파 HTTP 조회 실패 | ${error.message}`);
      if (!config.legacyHttpFallback) throw error;
    }
  }
  return checkSongpaVenuesWithPlaywright(venueIds, options);
}

async function checkSongpaVenuesHttp(venueIds, options = {}) {
  const ids = venueIds.filter((venueId) => VENUES[venueId]?.provider === "songpa");
  if (ids.length === 0) return {};
  assertSongpaLoginConfig();
  const session = new CookieSession();
  // Abort the actual HTTP request, including response-body reads, on timeout.
  const request = (url, init = {}) => session.request(url, {
    ...init, signal: AbortSignal.timeout(NAVIGATION_TIMEOUT_MS)
  });
  await request(SONGPA_LOGIN_URL);
  const login = await request("https://spc.esongpa.or.kr/bbs/login_check.php", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: SONGPA_LOGIN_URL
    },
    body: new URLSearchParams({
      rtn_url: "https://spc.esongpa.or.kr",
      rtn_par: "",
      mb_id: config.songpaUserId,
      mb_password: config.songpaUserPassword
    })
  });
  if (![301, 302, 303, 307, 308].includes(login.status)) throw new Error(`송파 로그인 HTTP ${login.status}`);
  const result = {};
  for (const venueId of ids) {
    const dates = options.venueDates?.[venueId] || [];
    const months = Array.from(new Set(dates.map((date) => String(date).slice(0, 7))));
    const pages = months.length > 0 ? months : [null];
    const items = [];
    for (const month of pages) {
      const url = `${VENUES[venueId].url}${month ? `?sch_sym=${encodeURIComponent(month)}` : ""}`;
      const response = await request(url, { headers: { referer: "https://spc.esongpa.or.kr/" } });
      const html = await response.text();
      if (!response.ok || isSongpaLoginPage({ url, html, body: html }) || !/calendar1_table/.test(html)) {
        throw new Error(`${VENUES[venueId].name} HTTP 인증/달력 응답이 아닙니다 (${response.status})`);
      }
      const parsed = parseLegacyCalendarHtml(html, venueId, "songpa");
      if (month && parsed.calendarMonth !== month) throw diagnosticError({
        type: "CALENDAR_DATE_NOT_FOUND", stage: "CALENDAR", provider: "songpa", venueId,
        targetDate: dates.filter(date => date.startsWith(month)).join(", "), retryable: false,
        message: "송파 HTTP 요청한 달이 표시되지 않았습니다: " + month
      });
      const missing = dates.filter(date => (!month || date.startsWith(month)) && !parsed.calendarDates.includes(date));
      if (missing.length) throw diagnosticError({
        type: "CALENDAR_DATE_NOT_FOUND", stage: "CALENDAR", provider: "songpa", venueId,
        targetDate: missing.join(", "), retryable: false, message: "송파 HTTP 날짜 셀을 찾지 못했습니다."
      });
      items.push(...parsed);
    }
    result[venueId] = items.filter((item) => dates.length === 0 || dates.includes(item.date));
  }
  return result;
}

async function checkSongpaVenuesWithPlaywright(venueIds, options = {}) {
  const ids = venueIds.filter((venueId) => VENUES[venueId]?.provider === "songpa");
  if (ids.length === 0) return {};

  const timer = createProviderTimer("송파");
  let errorForTimer = null;
  let session = await timer.step("브라우저 세션", () => openSongpaSession()).catch((error) => {
    throw diagnosticError({
      type: classifyError(error, { stage: "BROWSER" }).type,
      stage: "BROWSER",
      provider: "songpa",
      retryable: true,
      message: error.message,
      cause: error
    });
  });
  try {
    const loggedIn = await ensureSongpaLoggedIn(session.page, { timer });
    if (!loggedIn) {
      throw diagnosticError({
        type: "LOGIN_OR_PROTECTION_PAGE",
        stage: "AUTH_OR_PROTECTION",
        provider: "songpa",
        retryable: false,
        message: "송파구 로그인 완료 여부를 확인하지 못했습니다.",
        details: await inspectSongpaPage(session.page)
      });
    }

    const result = {};
    const errors = [];
    const retryVenueIds = [];
    for (const venueId of ids) {
      try {
        result[venueId] = await checkSongpaVenue(session.page, venueId, { timer, dates: options.venueDates?.[venueId] });
      } catch (error) {
        const diagnostic = classifyError(error, {
          provider: "songpa",
          venueId,
          targetDate: options.venueDates?.[venueId]?.join(", ") || null
        });
        errors.push(diagnostic);
        if (diagnostic.retryable) retryVenueIds.push(venueId);
        console.warn(`송파 조회 실패 | ${errorMessageForConsole(diagnostic)}`);
        if (diagnostic.stack) console.warn(diagnostic.stack);
      }
    }
    if (retryVenueIds.length > 0) {
      await Promise.resolve(session.context.close()).catch((error) => console.warn(`송파 브라우저 세션 종료 실패: ${error.message}`));
      await wait(options.retryDelayMs ?? 2500);
      session = await timer.step("브라우저 세션 재시도", () => openSongpaSession());
      const retryLoggedIn = await ensureSongpaLoggedIn(session.page, { timer });
      if (!retryLoggedIn) {
        const diagnostic = classifyError(new CheckDiagnosticError({
          type: "LOGIN_OR_PROTECTION_PAGE",
          stage: "AUTH_OR_PROTECTION",
          provider: "songpa",
          retryable: false,
          message: "재시도 송파구 로그인 완료 여부를 확인하지 못했습니다."
        }));
        for (const venueId of retryVenueIds) replaceVenueError(errors, venueId, { ...diagnostic, venueId, venueName: VENUES[venueId]?.name });
      } else {
        for (const venueId of retryVenueIds) {
          try {
            result[venueId] = await checkSongpaVenue(session.page, venueId, { timer, dates: options.venueDates?.[venueId] });
            removeVenueError(errors, venueId);
          } catch (error) {
            const diagnostic = classifyError(error, {
              provider: "songpa",
              venueId,
              targetDate: options.venueDates?.[venueId]?.join(", ") || null
            });
            replaceVenueError(errors, venueId, diagnostic);
            console.warn(`송파 재시도 실패 | ${errorMessageForConsole(diagnostic)}`);
            if (diagnostic.stack) console.warn(diagnostic.stack);
          }
        }
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
    await Promise.resolve(session?.context?.close()).catch((error) => console.warn(`송파 브라우저 세션 종료 실패: ${error.message}`));
    timer.end(errorForTimer);
  }
}

export async function checkSongpaVenue(page, venueId, options = {}) {
  const dates = Array.from(new Set((options.dates || []).map(date => String(date)))).sort();
  const months = dates.length ? Array.from(new Set(dates.map(date => date.slice(0, 7)))) : [null];
  const results = [];
  for (const month of months) {
    const monthDates = dates.filter(date => date.slice(0, 7) === month);
    const items = await checkSongpaVenueMonth(page, venueId, { ...options, dates: monthDates, targetMonth: month });
    if (month && items.calendarMonth !== month) throw diagnosticError({
      type: "CALENDAR_DATE_NOT_FOUND", stage: "CALENDAR", provider: "songpa", venueId,
      targetDate: monthDates.join(", "), retryable: false, message: "송파 요청한 달이 표시되지 않았습니다: " + month
    });
    const missing = monthDates.filter(date => !items.calendarDates?.includes(date));
    if (missing.length) throw diagnosticError({
      type: "CALENDAR_DATE_NOT_FOUND", stage: "CALENDAR", provider: "songpa", venueId,
      targetDate: missing.join(", "), retryable: false, message: "송파 날짜 셀을 찾지 못했습니다: " + missing.join(", ")
    });
    results.push(...items.filter(item => !dates.length || monthDates.includes(item.date)));
  }
  return results.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

async function checkSongpaVenueMonth(page, venueId, options = {}) {
  const venue = VENUES[venueId];
  if (!venue || venue.provider !== "songpa") throw new Error(`Unknown Songpa venue: ${venueId}`);
  const timer = options.timer;

  const response = await maybeStep(timer, `${venue.name} 페이지 접근`, async () => {
    const navResponse = await page.goto(options.targetMonth ? `${venue.url}?sch_sym=${encodeURIComponent(options.targetMonth)}` : venue.url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return navResponse;
  }).catch((error) => {
    throw diagnosticError({
      type: classifyError(error, { stage: "NAVIGATION" }).type,
      stage: "NAVIGATION",
      provider: "songpa",
      venueId,
      targetDate: options.dates?.join(", ") || null,
      retryable: classifyError(error).retryable,
      message: error.message,
      cause: error
    });
  });
  const status = response?.status?.();
  if (Number.isFinite(status) && status >= 400) {
    throw diagnosticError({
      type: status >= 500 ? "HTTP_ERROR" : "HTTP_BLOCKED_OR_NOT_FOUND",
      stage: "HTTP",
      provider: "songpa",
      venueId,
      targetDate: options.dates?.join(", ") || null,
      retryable: status >= 500,
      message: `${venue.name} HTTP ${status}`,
      details: { status, url: response?.url?.() || page.url() }
    });
  }

  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const html = typeof page.content === "function" ? await page.content() : "";
  if (isSongpaLoginPage({ url: typeof page.url === "function" ? page.url() : "", html, body })) {
    throw diagnosticError({
      type: "LOGIN_OR_PROTECTION_PAGE",
      stage: "AUTH_OR_PROTECTION",
      provider: "songpa",
      venueId,
      targetDate: options.dates?.join(", ") || null,
      retryable: false,
      message: `${venue.name} 예약현황이 로그인 페이지로 보입니다.`,
      details: await inspectSongpaPage(page, body)
    });
  }
  if (!body.trim()) {
    throw diagnosticError({
      type: "EMPTY_PAGE",
      stage: "HTTP",
      provider: "songpa",
      venueId,
      targetDate: options.dates?.join(", ") || null,
      retryable: true,
      message: `${venue.name} 예약현황 페이지 본문이 비어 있습니다.`,
      details: await inspectSongpaPage(page, body)
    });
  }

  const reservations = await maybeStep(timer, `${venue.name} 예약 데이터 파싱`, () => parseSongpaReservationDom(page, venueId)).catch((error) => {
    throw diagnosticError({
      type: "PARSE_FAILED",
      stage: "PARSE",
      provider: "songpa",
      venueId,
      targetDate: options.dates?.join(", ") || null,
      retryable: false,
      message: error.message,
      cause: error
    });
  });
  return reservations;
}

// A navigation login link is present even on valid public calendars.
export function isSongpaLoginPage({ url = "", html = "", body = "" } = {}) {
  if (/\/bbs\/login\.php(?:[?#]|$)/i.test(url)) return true;
  const hasCalendar = /class=["'][^"']*\bcalendar1_table\b/i.test(html);
  const hasLoginForm = /<input\b[^>]*(?:type=["']password["']|name=["']mb_password["'])/i.test(html)
    || /<form\b[^>]*(?:id=["']flogin["']|action=["'][^"']*login_check\.php)/i.test(html);
  if (hasCalendar) return false;
  return hasLoginForm || /로그인\s*후\s*(?:이용|접근|조회)|로그인이\s*필요|접근이\s*차단|비정상적인\s*접근/.test(body);
}

export async function parseSongpaReservationDom(page, venueId) {
  if (typeof page.content === "function") return parseSongpaCalendarHtml(await page.content(), venueId);
  const snapshot = await page.evaluate(() => {
    const header = document.querySelector(".calendar1_yearmonth strong")?.textContent || "";
    const ym = header.match(/(20\d{2})\s*\.\s*(\d{1,2})/);
    return { year: ym?.[1], month: ym?.[2], cells: Array.from(document.querySelectorAll(".calendar1_table td")).map(cell => ({
      day: cell.querySelector("h6")?.textContent?.trim(),
      text: (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim(),
      slots: Array.from(cell.querySelectorAll("li")).map(li => ({ text: (li.innerText || li.textContent || "").replace(/\s+/g, " ").trim() }))
    })) };
  });
  return parseSongpaCalendarSnapshot(snapshot, venueId);
}

export function songpaVenueIdsFromWatches(watches) {
  return Array.from(new Set(
    watches.flatMap((watch) => watch.venues || []).filter((venueId) => VENUES[venueId]?.provider === "songpa")
  ));
}

export const SONGPA_TIME_SLOTS = TIME_SLOTS;

function maybeStep(timer, label, fn) {
  return timer ? timer.step(label, fn) : fn();
}

async function inspectSongpaPage(page, bodyText = null) {
  const [title, body] = await Promise.all([
    page.title?.().catch(() => "") || "",
    bodyText == null ? page.locator("body").innerText({ timeout: 3000 }).catch(() => "") : bodyText
  ]);
  const url = typeof page.url === "function" ? page.url() : "";
  return {
    url,
    title,
    redirect: /\/bbs\/login\.php|login/i.test(url),
    bodySample: String(body || "").replace(/\s+/g, " ").trim().slice(0, 300)
  };
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
