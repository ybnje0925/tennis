import { fileURLToPath } from "node:url";
import { openGangdongSession, ensureLoggedIn, looksLikeProtectionOrLogin } from "./browserSession.js";
import { VENUES } from "./constants.js";
import { parseReservationDom } from "./parser.js";

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
    examples: slots.slice(0, 5)
  };
}

export async function runDiagnosis() {
  const { context, page } = await openGangdongSession({ headless: false });
  try {
    const loginSucceeded = await ensureLoggedIn(page);
    const venues = {};

    if (loginSucceeded) {
      for (const venueId of Object.keys(VENUES)) {
        venues[venueId] = await diagnoseVenue(page, venueId);
      }
    }

    return {
      loginSucceeded,
      webGatePassed: Object.values(venues).length > 0 && Object.values(venues).every((item) => item.webGatePassed),
      venues
    };
  } finally {
    await context.close();
  }
}

function printDiagnosis(result) {
  const gangil = result.venues.gangil;
  const myeongil = result.venues.myeongil;
  const examples = Object.values(result.venues).flatMap((venue) => venue.examples).slice(0, 5);

  console.log(JSON.stringify({
    loginSucceeded: result.loginSucceeded,
    gangilCalendarAccess: Boolean(gangil?.calendarAccess),
    myeongilCalendarAccess: Boolean(myeongil?.calendarAccess),
    webGatePassed: result.webGatePassed,
    parsedSlotExamples: examples,
    parsedCounts: {
      gangil: gangil?.parsedCount ?? 0,
      myeongil: myeongil?.parsedCount ?? 0
    },
    remainingIssues: examples.length === 0 ? ["예약 달력 DOM에서 슬롯을 파싱하지 못했습니다."] : []
  }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDiagnosis()
    .then(printDiagnosis)
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
