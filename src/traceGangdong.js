import { fileURLToPath } from "node:url";
import { openGangdongSession, ensureLoggedIn, looksLikeProtectionOrLogin } from "./browserSession.js";
import { VENUES } from "./constants.js";
import { checkVenue } from "./checker.js";
import { findNotifications, keyFor } from "./monitor.js";
import { parseReservationDom } from "./parser.js";
import { reservationKey } from "./normalization.js";

const TARGET = {
  venue: "gangil",
  date: "2026-08-27",
  time: "06:00~08:00"
};

async function collectDomTrace(page) {
  return page.evaluate((target) => {
    const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
    const tables = Array.from(document.querySelectorAll(".calendar1_table, table")).map((table, index) => ({
      index,
      className: table.className || "",
      caption: clean(table.caption?.innerText || table.caption?.textContent || ""),
      parentText: clean(table.parentElement?.innerText || "").slice(0, 500),
      tableText: clean(table.innerText || table.textContent || "").slice(0, 500)
    }));
    const targetCells = Array.from(document.querySelectorAll(".calendar1_table td, table td"))
      .filter((cell) => clean(cell.innerText || cell.textContent || "").match(/^27\b/))
      .map((cell) => ({
        text: clean(cell.innerText || cell.textContent || ""),
        tableClass: cell.closest("table")?.className || "",
        parentText: clean(cell.closest("table")?.parentElement?.innerText || "").slice(0, 500),
        rawSlots: Array.from(cell.querySelectorAll("li")).map((item) => clean(item.innerText || item.textContent || ""))
      }));
    return { target, tables, targetCells };
  }, TARGET);
}

export async function runGangdongTrace() {
  const { context, page } = await openGangdongSession({ headless: true });
  try {
    const loginSucceeded = await ensureLoggedIn(page);
    if (!loginSucceeded) throw new Error("로그인 완료 여부를 확인하지 못했습니다.");

    const venue = VENUES[TARGET.venue];
    await page.goto(venue.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    if (await looksLikeProtectionOrLogin(page)) {
      throw new Error("예약현황이 실제 달력이 아니라 로그인/보호 페이지로 보입니다.");
    }

    const dom = await collectDomTrace(page);
    const parsed = await parseReservationDom(page, TARGET.venue);
    const targetKey = reservationKey(TARGET);
    const parsedTarget = parsed.find((item) => keyFor(item) === targetKey) || null;

    let filtered = [];
    let filterError = null;
    try {
      filtered = await checkVenue(page, TARGET.venue, { dates: [TARGET.date] });
    } catch (error) {
      filterError = error.message;
    }

    const state = {
      users: [{ id: "u1", telegramChatId: "trace-chat", telegramConnected: true, enabled: true }],
      watches: [{ id: "trace-watch", userId: "u1", venues: [TARGET.venue], date: TARGET.date, times: [TARGET.time], enabled: true }],
      lastAvailability: {},
      sentNotifications: {},
      system: { logs: [], venues: {}, providers: {} }
    };
    const notifications = findNotifications(state, parsed);

    return {
      trace: TARGET,
      dom,
      parsedCount: parsed.length,
      parsedDates: Array.from(new Set(parsed.map((item) => item.date))).sort(),
      parsedTarget,
      dateFilter: {
        target: TARGET.date,
        survived: filtered.some((item) => keyFor(item) === targetKey),
        count: filtered.length,
        error: filterError
      },
      watchMatching: {
        watchKey: targetKey,
        reservationKey: parsedTarget ? keyFor(parsedTarget) : null,
        keyMatched: Boolean(parsedTarget),
        available: parsedTarget?.available ?? null
      },
      notification: {
        candidate: notifications.some((item) => item.key === targetKey),
        count: notifications.length,
        alreadySent: Boolean(state.sentNotifications[`trace-watch|${targetKey}`])
      }
    };
  } finally {
    await context.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runGangdongTrace()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
