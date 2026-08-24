import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  COURT_TYPES,
  ensureOlympicLoggedIn,
  fetchOlympicAvailabilityForDate,
  inspectOlympicReservationPage,
  openOlympicSession,
  readOlympicCalendar
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
    const calendar = loginSucceeded ? await readOlympicCalendar(page) : null;
    const byCourtType = {};
    const slots = [];
    if (loginSucceeded) {
      for (const courtType of Object.keys(COURT_TYPES)) {
        try {
          const availability = await fetchOlympicAvailabilityForDate(page, { date, courtType });
          byCourtType[courtType] = availability;
          slots.push(...availability.slots);
        } catch (error) {
          byCourtType[courtType] = {
            error: error.message,
            code: error.code || "",
            dateStatus: null,
            timeSlots: [],
            slots: []
          };
        }
      }
    }

    return {
      loginSucceeded,
      reservationPageAccess: loginSucceeded && !/\/sso\/usr\/login\/view/.test(page.url()),
      date,
      calendar,
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
  console.log(result.loginSucceeded ? "Olympic login success" : "Olympic login failed");
  console.log(result.reservationPageAccess ? "예약신청 페이지 접근 성공" : "예약신청 페이지 접근 실패");
  console.log("");
  console.log(`Target date: ${result.date}`);
  console.log(`Date cell found: ${result.calendar?.cells?.some((cell) => cell.date === result.date) ? "yes" : "no"}`);
  const targetCell = result.calendar?.cells?.find((cell) => cell.date === result.date);
  if (targetCell) console.log(`Available count: ${targetCell.possibleCount}`);
  console.log("");

  if (result.calendar) {
    console.log("Olympic calendar period:");
    console.log(result.calendar.periodText || "unknown");
    console.log("");
    console.log("Detected date cells:");
    for (const cell of result.calendar.cells) {
      console.log(cell.day);
    }
    console.log("");
    for (const cell of result.calendar.cells) {
      console.log(cell.rawText);
    }
    console.log("");
  }

  for (const [courtType, availability] of Object.entries(result.byCourtType || {})) {
    const label = COURT_TYPES[courtType];
    if (availability.error) {
      console.log(`${label} 조회 실패: ${availability.error}`);
    } else if (availability.dateStatus) {
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
