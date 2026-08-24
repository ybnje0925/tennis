import { fileURLToPath } from "node:url";
import { VENUES } from "./constants.js";
import {
  checkSongpaVenue,
  ensureSongpaLoggedIn,
  openSongpaSession,
  songpaProvider
} from "./providers/songpaProvider.js";

const SONGPA_VENUE_IDS = songpaProvider.venues;

export async function runSongpaDiagnosis() {
  const { context, page } = await openSongpaSession();
  try {
    const loginSucceeded = await ensureSongpaLoggedIn(page);
    const venues = {};

    if (loginSucceeded) {
      for (const venueId of SONGPA_VENUE_IDS) {
        venues[venueId] = await checkSongpaVenue(page, venueId);
      }
    }

    return { loginSucceeded, venues };
  } finally {
    await context.close();
  }
}

function printDiagnosis(result) {
  console.log("[Songpa]");
  console.log(result.loginSucceeded ? "로그인 성공" : "로그인 실패");
  console.log("");

  for (const venueId of SONGPA_VENUE_IDS) {
    const venue = VENUES[venueId];
    const items = result.venues[venueId] || [];
    console.log(venue.name);
    if (items.length === 0) {
      console.log("예약현황 없음");
      console.log("");
      continue;
    }

    for (const item of items.filter((slot) => slot.available).slice(0, 8)) {
      const dateLabel = `${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8, 10))}`;
      const countLabel = Number.isFinite(item.availableCount) ? ` ${item.availableCount}` : "";
      console.log(`${dateLabel} ${item.time} 예약가능${countLabel}`);
    }
    console.log("");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSongpaDiagnosis()
    .then(printDiagnosis)
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
