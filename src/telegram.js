import { config } from "./config.js";
import { VENUES } from "./constants.js";

export function canSendTelegram() {
  return Boolean(config.telegramBotToken && config.telegramChatId);
}

export async function sendTelegram(message) {
  if (!canSendTelegram()) {
    console.warn("Telegram is not configured. Notification skipped.");
    return { ok: false, skipped: true };
  }

  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text: message,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram send failed: ${response.status} ${text.slice(0, 160)}`);
  }
  return response.json();
}

export function buildNotificationMessage(item) {
  const month = Number(item.date.slice(5, 7));
  const day = Number(item.date.slice(8, 10));
  const venue = VENUES[item.venue];
  return [
    "테니스 잡아줘",
    "",
    `${item.venueName} 빈자리 발견!`,
    "",
    `${month}월 ${day}일`,
    item.time,
    "",
    `현재 예약 가능 코트: ${item.availableCount}개`,
    "",
    "예약은 사용자가 직접 진행해야 합니다.",
    venue.url
  ].join("\n");
}
