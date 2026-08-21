import { VENUES } from "./constants.js";
import { runHeadlessDiagnosis } from "./headlessDiagnose.js";
import { sendAvailabilityAlert } from "./telegramNotifier.js";

const mockSlots = [
  {
    venue: "gangil",
    venueName: "강일테니스장",
    date: "2026-08-24",
    time: "18:00~20:00",
    available: true,
    availableCount: 1
  },
  {
    venue: "myeongil",
    venueName: "명일테니스장",
    date: "2026-08-24",
    time: "14:00~16:00",
    available: true,
    availableCount: 2
  }
];

function firstAvailableSlot(reservationsByVenue) {
  return Object.values(reservationsByVenue)
    .flat()
    .find((item) => item.available && item.availableCount > 0);
}

async function sendMockAlerts() {
  for (const slot of mockSlots) {
    await sendAvailabilityAlert(slot);
  }
  console.log("Telegram mock alert sent successfully");
}

async function sendLiveAlert() {
  const diagnosis = await runHeadlessDiagnosis();
  if (!diagnosis.loginSucceeded || !diagnosis.webGatePassed) {
    throw new Error("Headless 예약현황 조회가 정상 완료되지 않았습니다.");
  }

  const reservations = Object.fromEntries(
    Object.entries(diagnosis.venues).map(([venueId, result]) => [venueId, result.slots])
  );
  const slot = firstAvailableSlot(reservations);

  if (!slot) {
    console.log("현재 실제 예약가능 슬롯이 없어 알림을 보내지 않았습니다.");
    return;
  }

  await sendAvailabilityAlert(slot);
  console.log(`Telegram availability alert sent successfully: ${VENUES[slot.venue].name}`);
}

const mode = process.argv.includes("--mock") ? "mock" : "live";

(mode === "mock" ? sendMockAlerts() : sendLiveAlert()).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
