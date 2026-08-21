import { chromium } from "playwright";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureLoggedIn, isLoggedIn, looksLikeProtectionOrLogin } from "./browserSession.js";
import { VENUES } from "./constants.js";
import { parseReservationDom } from "./parser.js";

const SESSION_DIR = path.resolve("sessions");
const STORAGE_STATE_PATH = path.join(SESSION_DIR, "gangdong-storage-state.json");

async function fileExists(filePath) {
  return stat(filePath).then(() => true).catch(() => false);
}

async function openHeadlessSession() {
  await mkdir(SESSION_DIR, { recursive: true });
  const hasStoredState = await fileExists(STORAGE_STATE_PATH);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...(hasStoredState ? { storageState: STORAGE_STATE_PATH } : {}),
    viewport: { width: 1365, height: 900 },
    locale: "ko-KR"
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return { browser, context, page, hasStoredState };
}

async function diagnoseVenue(page, venueId) {
  const venue = VENUES[venueId];
  await page.goto(venue.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const protectedOrLogin = await looksLikeProtectionOrLogin(page);
  const slots = protectedOrLogin ? [] : await parseReservationDom(page, venueId);

  return {
    venue: venueId,
    venueName: venue.name,
    url: page.url(),
    calendarAccess: !protectedOrLogin && slots.length > 0,
    webGatePassed: !protectedOrLogin,
    parsedCount: slots.length,
    slots,
    examples: slots.slice(0, 5)
  };
}

export async function runHeadlessDiagnosis() {
  const { browser, context, page, hasStoredState } = await openHeadlessSession();
  try {
    let usedStoredSession = false;
    let loginSucceeded = false;

    if (hasStoredState && await isLoggedIn(page)) {
      usedStoredSession = true;
      loginSucceeded = true;
    } else {
      loginSucceeded = await ensureLoggedIn(page);
      if (loginSucceeded) {
        await context.storageState({ path: STORAGE_STATE_PATH });
      }
    }

    const venues = {};
    if (loginSucceeded) {
      for (const venueId of Object.keys(VENUES)) {
        venues[venueId] = await diagnoseVenue(page, venueId);
      }
    }

    return {
      headless: true,
      loginSucceeded,
      hadStoredSession: hasStoredState,
      usedStoredSession,
      savedSession: loginSucceeded,
      webGatePassed: Object.values(venues).length > 0 && Object.values(venues).every((item) => item.webGatePassed),
      venues
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

function printDiagnosis(result) {
  const gangil = result.venues.gangil;
  const myeongil = result.venues.myeongil;
  const examples = Object.values(result.venues).flatMap((venue) => venue.examples).slice(0, 5);

  console.log(JSON.stringify({
    headless: result.headless,
    loginSucceeded: result.loginSucceeded,
    webGatePassed: result.webGatePassed,
    gangilParsed: Boolean(gangil?.calendarAccess),
    myeongilParsed: Boolean(myeongil?.calendarAccess),
    hadStoredSession: result.hadStoredSession,
    usedStoredSession: result.usedStoredSession,
    savedSession: result.savedSession,
    parsedCounts: {
      gangil: gangil?.parsedCount ?? 0,
      myeongil: myeongil?.parsedCount ?? 0
    },
    parsedSlotExamples: examples,
    remainingIssues: examples.length === 0 ? ["Headless 달력 DOM에서 슬롯을 파싱하지 못했습니다."] : []
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runHeadlessDiagnosis()
    .then(printDiagnosis)
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
