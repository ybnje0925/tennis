import { openGangdongSession, ensureLoggedIn, looksLikeProtectionOrLogin } from "./browserSession.js";
import { VENUES } from "./constants.js";
import { parseReservationDom } from "./parser.js";
import { checkOlympicByWatches, isOlympicWatch } from "./providers/olympicProvider.js";
import { checkSongpaVenues, songpaVenueIdsFromWatches } from "./providers/songpaProvider.js";
import { fileURLToPath } from "node:url";

export async function checkVenue(page, venueId) {
  const venue = VENUES[venueId];
  if (!venue) throw new Error(`Unknown venue: ${venueId}`);

  await page.goto(venue.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  if (await looksLikeProtectionOrLogin(page)) {
    throw new Error(`${venue.name} 예약현황이 실제 달력이 아니라 로그인/보호 페이지로 보입니다.`);
  }

  const reservations = await parseReservationDom(page, venueId);
  if (reservations.length === 0) {
    throw new Error(`${venue.name} 예약현황 DOM에서 예약 데이터를 찾지 못했습니다.`);
  }
  return reservations;
}

export async function checkGangdongVenues(venueIds) {
  const ids = venueIds.filter((venueId) => VENUES[venueId]?.provider === "gangdong");
  if (ids.length === 0) return {};

  const { context, page } = await openGangdongSession();
  try {
    const loggedIn = await ensureLoggedIn(page);
    if (!loggedIn) throw new Error("로그인 완료 여부를 확인하지 못했습니다.");

    const result = {};
    for (const venueId of ids) {
      result[venueId] = await checkVenue(page, venueId);
    }
    return result;
  } finally {
    await context.close();
  }
}

export async function checkAllVenues(options = {}) {
  const watches = options.watches || [];
  const watchedVenueIds = new Set(
    watches.length > 0
      ? watches.flatMap((watch) => watch.venues || (watch.venue ? [watch.venue] : []))
      : Object.keys(VENUES).filter((venueId) => VENUES[venueId].provider !== "olympic")
  );

  const result = await checkGangdongVenues(Array.from(watchedVenueIds));
  Object.assign(result, await checkSongpaVenues(songpaVenueIdsFromWatches(watches)));
  const olympicWatches = watches.filter(isOlympicWatch);
  if (olympicWatches.length > 0) {
    result.olympic = await checkOlympicByWatches(olympicWatches);
  }
  return result;
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
