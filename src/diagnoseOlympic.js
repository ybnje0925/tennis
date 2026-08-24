import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  COURT_TYPES,
  ensureOlympicLoggedIn,
  fetchOlympicAvailabilityForDate,
  inspectOlympicReservationPage,
  openOlympicSession
} from "./providers/olympicProvider.js";

function defaultDate() {
  const date = new Date();
  date.setDate(date.getDate() + 6);
  return date.toISOString().slice(0, 10);
}

export async function runOlympicDiagnosis(options = {}) {
  const date = options.date || process.env.OLYMPIC_DIAGNOSE_DATE || defaultDate();
  const { context, page } = await openOlympicSession({ headless: config.headless });

  try {
    const loginSucceeded = await ensureOlympicLoggedIn(page);
    const pageSnapshot = loginSucceeded ? await inspectOlympicReservationPage(page) : null;
    const byCourtType = {};
    const slots = [];
    if (loginSucceeded) {
      for (const courtType of Object.keys(COURT_TYPES)) {
        const availability = await fetchOlympicAvailabilityForDate(page, { date, courtType });
        byCourtType[courtType] = availability;
        slots.push(...availability.slots);
      }
    }

    return {
      loginSucceeded,
      reservationPageAccess: loginSucceeded && !/\/sso\/usr\/login\/view/.test(page.url()),
      date,
      pageSnapshot,
      byCourtType,
      slots
    };
  } finally {
    await context.close();
  }
}

function printDiagnosis(result) {
  console.log("[Olympic]");
  console.log(result.loginSucceeded ? "로그인 성공" : "로그인 실패");
  console.log(result.reservationPageAccess ? "예약신청 페이지 접근 성공" : "예약신청 페이지 접근 실패");
  console.log("");
  console.log(result.date);
  console.log("");

  for (const [courtType, availability] of Object.entries(result.byCourtType || {})) {
    const label = COURT_TYPES[courtType];
    if (availability.dateStatus) {
      console.log(`${label} 날짜 상태: 가능 ${availability.dateStatus.possibleCount}건 / 진행 ${availability.dateStatus.pendingCount}건 / 마감 ${availability.dateStatus.closedCount}건`);
    } else {
      console.log(`${label} 날짜 상태: 확인 못함`);
    }
  }

  const byTime = new Map();
  for (const slot of result.slots) {
    const key = `${slot.startTime}~${slot.endTime}`;
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(slot.courtNo);
  }

  if (byTime.size === 0) {
    console.log("가능코트: 없음 또는 코트 영역 미확인");
  } else {
    for (const [time, courts] of byTime) {
      console.log("");
      console.log(time);
      console.log(`가능코트: ${courts.join(", ") || "없음"}`);
    }
  }

  if (result.pageSnapshot) {
    console.log("");
    console.log("구조 요약:");
    console.log(`현재 URL: ${result.pageSnapshot.url}`);
    console.log(`스크립트: ${result.pageSnapshot.scripts.length}개`);
    console.log(`KSPO 요청: ${result.pageSnapshot.requests.length}개`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runOlympicDiagnosis()
    .then(printDiagnosis)
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
