import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, assertSongpaLoginConfig } from "../config.js";
import { PROVIDERS, SONGPA_LOGIN_URL, TIME_SLOTS, VENUES } from "../constants.js";

const SESSION_DIR = path.resolve(config.sessionDir, "songpa-profile");

export const songpaProvider = {
  ...PROVIDERS.songpa,
  reservationUrl: "https://spc.esongpa.or.kr/"
};

export function isSongpaWatch(watch) {
  return (watch.venues || []).some((venueId) => VENUES[venueId]?.provider === "songpa");
}

export async function openSongpaSession(options = {}) {
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

export async function isSongpaLoggedIn(page) {
  await page.goto("https://spc.esongpa.or.kr/", { waitUntil: "domcontentloaded" }).catch(() => {});
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return /로그아웃|마이페이지|대관결제내역|정보수정/.test(body);
}

export async function ensureSongpaLoggedIn(page) {
  if (await isSongpaLoggedIn(page)) return true;

  assertSongpaLoginConfig();
  await page.goto(SONGPA_LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  await page.locator("input[name='mb_id'], #login_id").first().fill(config.songpaUserId);
  await page.locator("input[name='mb_password'], input[type='password']").first().fill(config.songpaUserPassword);

  const dialogMessages = [];
  page.on("dialog", async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept().catch(() => {});
  });

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {}),
    page.locator("input[type='submit'], button[type='submit'], .btn-login").first().click()
  ]);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  const loggedIn = await isSongpaLoggedIn(page);
  if (!loggedIn && dialogMessages.length > 0) {
    throw new Error(`Songpa login failed: ${dialogMessages.at(-1)}`);
  }
  return loggedIn;
}

export async function checkSongpaVenues(venueIds) {
  const ids = venueIds.filter((venueId) => VENUES[venueId]?.provider === "songpa");
  if (ids.length === 0) return {};

  const { context, page } = await openSongpaSession();
  try {
    const loggedIn = await ensureSongpaLoggedIn(page);
    if (!loggedIn) throw new Error("송파구 로그인 완료 여부를 확인하지 못했습니다.");

    const result = {};
    for (const venueId of ids) {
      result[venueId] = await checkSongpaVenue(page, venueId);
    }
    return result;
  } finally {
    await context.close();
  }
}

export async function checkSongpaVenue(page, venueId) {
  const venue = VENUES[venueId];
  if (!venue || venue.provider !== "songpa") throw new Error(`Unknown Songpa venue: ${venueId}`);

  await page.goto(venue.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/로그인|아이디|비밀번호/.test(body) && !/로그아웃|마이페이지/.test(body)) {
    throw new Error(`${venue.name} 예약현황이 로그인 페이지로 보입니다.`);
  }

  const reservations = await parseSongpaReservationDom(page, venueId);
  if (reservations.length === 0) {
    throw new Error(`${venue.name} 예약현황 DOM에서 예약 데이터를 찾지 못했습니다.`);
  }
  return reservations;
}

export async function parseSongpaReservationDom(page, venueId) {
  const rows = await page.evaluate(() => {
    const bodyText = document.body.innerText || "";
    const yearMonth = bodyText.match(/(20\d{2})\s*\.\s*([01]?\d)/);
    const cells = Array.from(document.querySelectorAll(".calendar1_table td, table td"));

    return {
      year: yearMonth?.[1] || "",
      month: yearMonth?.[2] || "",
      cells: cells.map((cell) => ({
        text: (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim(),
        slots: Array.from(cell.querySelectorAll("li")).map((item) => ({
          text: (item.innerText || item.textContent || "").replace(/\s+/g, " ").trim(),
          href: item.querySelector("a")?.href || ""
        }))
      }))
    };
  });

  return parseSongpaCalendarSnapshot(rows, venueId);
}

export function parseSongpaCalendarSnapshot(snapshot, venueId) {
  const venue = VENUES[venueId];
  if (!venue) throw new Error(`Unknown venue: ${venueId}`);

  const year = snapshot.year;
  const month = String(snapshot.month).padStart(2, "0");
  if (!year || !month) return [];

  const results = [];
  for (const cell of snapshot.cells || []) {
    const day = cell.text.match(/^([0-3]?\d)\b/)?.[1];
    if (!day) continue;

    for (const slot of cell.slots || []) {
      const parsed = parseSongpaSlotText(slot.text);
      if (!parsed) continue;

      results.push({
        provider: "songpa",
        venue: venue.id,
        venueName: venue.name,
        date: `${year}-${month}-${day.padStart(2, "0")}`,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        time: `${parsed.startTime}~${parsed.endTime}`,
        durationMinutes: 120,
        available: parsed.available,
        availableCount: parsed.availableCount,
        totalCount: parsed.totalCount,
        reservedCount: parsed.reservedCount,
        rawStatus: slot.text
      });
    }
  }

  return results.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

export function parseSongpaSlotText(text) {
  const normalized = text.replace(/\s+/g, "");
  const match = normalized.match(/([0-2]?\d:00)~([0-2]?\d:00)(예약가능|예약완료|예약불가)(?:\((\d+)\/(\d+)\))?/);
  if (!match) return null;

  const reservedCount = match[4] == null ? null : Number.parseInt(match[4], 10);
  const totalCount = match[5] == null ? null : Number.parseInt(match[5], 10);
  const available = match[3] === "예약가능";
  const availableCount = available && Number.isFinite(reservedCount) && Number.isFinite(totalCount)
    ? Math.max(0, totalCount - reservedCount)
    : undefined;

  return {
    startTime: match[1].padStart(5, "0"),
    endTime: match[2].padStart(5, "0"),
    status: match[3],
    available,
    availableCount,
    reservedCount,
    totalCount
  };
}

export function songpaVenueIdsFromWatches(watches) {
  return Array.from(new Set(
    watches.flatMap((watch) => watch.venues || []).filter((venueId) => VENUES[venueId]?.provider === "songpa")
  ));
}

export const SONGPA_TIME_SLOTS = TIME_SLOTS;
