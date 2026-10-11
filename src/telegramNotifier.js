import { config } from "./config.js";
import { VENUES } from "./constants.js";
import { formatKoreanDateWithWeekday } from "../public/dateFormat.js";

export class TelegramConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelegramConfigurationError";
  }
}

export function assertTelegramConfig() {
  if (!config.telegramBotToken) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }
  if (!config.telegramChatId) {
    throw new TelegramConfigurationError("TELEGRAM_CHAT_ID is not configured");
  }
}

export function canSendTelegram() {
  return Boolean(config.telegramBotToken && config.telegramChatId);
}

export async function sendTelegramMessage(message, options = {}) {
  if (!config.telegramBotToken) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }
  const chatId = options.chatId || config.telegramChatId;
  if (!chatId) {
    throw new TelegramConfigurationError("Telegram chat id is not configured");
  }

  const body = {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: true
  };

  if (options.url) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "예약페이지 열기", url: options.url }]]
    };
  }

  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
  } catch {
    // A lost response may follow an accepted message. Telegram has no idempotency key.
    const error = new Error("Telegram response unavailable; delivery outcome unknown");
    error.deliveryUncertain = true;
    throw error;
  }

  if (!response.ok) {
    const detail = await readTelegramError(response);
    throw new Error(`Telegram send failed: ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  let result;
  try { result = await response.json(); }
  catch { const error = new Error("Telegram response unreadable; delivery outcome unknown"); error.deliveryUncertain = true; throw error; }
  if (result.ok !== true) throw new Error("Telegram API rejected the message");
  return result;
}

async function readTelegramError(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.description === "string") return parsed.description.slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
  return "";
}

export function buildTelegramTestMessage() {
  return [
    "🎾 테니스 잡아줘",
    "",
    "Telegram 알림 테스트 성공!",
    "",
    "강일·명일 빈자리 알림 시스템이 정상적으로 연결되었습니다."
  ].join("\n");
}

export function buildTelegramConnectionTestMessage() {
  return [
    "🎾 테니스 잡아줘",
    "",
    "텔레그램 연결 상태가 정상입니다.",
    "이 채팅으로 빈자리 알림을 보내드릴게요."
  ].join("\n");
}

export function buildAvailabilityMessage(item) {
  if (item.provider === "nowon") return buildNowonMessage([item]);
  if (item.provider === "jungnang") return buildMyeonmokMessage([item]);
  if (item.provider === "hanam") return buildHanamAvailabilityMessage(item);
  if (item.provider === "olympic") return buildOlympicAvailabilityMessage(item);

  const venue = VENUES[item.venue];
  const countLine = Number.isFinite(item.availableCount)
    ? `${item.provider === "songpa" ? "예약 가능 코트" : "현재 예약 가능 코트"}: ${item.availableCount}개`
    : null;

  return [
    "🎾 테니스 잡아줘",
    "",
    `${item.venueName} 빈자리 발견!`,
    "",
    formatKoreanDateWithWeekday(item.date),
    item.time,
    "",
    countLine,
    "",
    "지금 예약사이트를 확인하세요.",
    venue?.url ?? ""
  ].filter(Boolean).join("\n");
}

export function buildHanamAvailabilityMessage(item) {
  const venue = VENUES[item.venue];
  return [
    "🎾 테니스 잡아줘",
    "",
    `${displayVenueName(item)} 빈자리!`,
    "",
    item.courtNo ? `${item.courtNo}코트` : null,
    formatKoreanDateWithWeekday(item.date),
    `${item.startTime}~${item.endTime}`,
    "",
    "예약 가능합니다.",
    venue?.url ?? ""
  ].filter(Boolean).join("\n");
}

export function buildAggregatedAvailabilityMessage(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  if (items.length === 1) return buildAvailabilityMessage(items[0]);

  if (items[0].provider === "nowon") return buildNowonMessage(items);
  if (items[0].provider === "jungnang") return buildMyeonmokMessage(items);
  const first = items[0];
  const venue = VENUES[first.venue];
  const lines = items
    .slice()
    .sort((a, b) => `${a.date} ${a.startTime} ${a.courtNo || ""}`.localeCompare(`${b.date} ${b.startTime} ${b.courtNo || ""}`))
    .map((item) => `- ${item.courtNo ? `${item.courtNo}코트 ` : ""}${item.startTime || item.time?.split("~")[0]}~${item.endTime || item.time?.split("~")[1]}`);

  return [
    "🎾 테니스 잡아줘",
    "",
    `${displayVenueName(first)} 빈자리!`,
    "",
    formatKoreanDateWithWeekday(first.date),
    "",
    "예약 가능",
    ...lines,
    "",
    "지금 예약사이트를 확인하세요.",
    venue?.url ?? ""
  ].filter(Boolean).join("\n");
}

function displayVenueName(item) {
  if (item.facilityGroup === "misa") return "미사한강공원 테니스장";
  return item.venueName || VENUES[item.venue]?.name || item.venue;
}

export function buildOlympicAvailabilityMessage(item) {
  const venue = VENUES.olympic;
  return [
    "🎾 테니스 잡아줘",
    "",
    "올림픽공원 테니스장 빈자리!",
    "",
    `${item.courtNo}번 코트`,
    formatKoreanDateWithWeekday(item.date),
    `${item.startTime}~${item.endTime}`,
    "",
    "예약 가능합니다.",
    venue.url
  ].filter(Boolean).join("\n");
}

export async function sendAvailabilityAlert(item) {
  const venue = VENUES[item.venue];
  return sendTelegramMessage(buildAvailabilityMessage(item), { url: venue?.url });
}

export function buildMyeonmokMessage(items) {
  const sorted = items.slice().sort((a,b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  return ["🎾 테니스 잡아줘", "", "면목구립테니스장 빈자리 발견!",
    ...sorted.flatMap(item => [formatKoreanDateWithWeekday(item.date),
      item.part + "부 " + item.time + " · 잔여 " + item.availableCount + "팀",
      item.warning || null]),
    "", "실제 신청 가능 여부는 공식 사이트에서 확인",
    VENUES.myeonmok.publicUrl].filter(Boolean).join("\n");
}

export function buildNowonMessage(items) {
  const first = items[0];
  return ["🎾 노원 " + (first.venueName || VENUES[first.venue]?.name) + " 빈자리",
    "📅 " + formatKoreanDateWithWeekday(first.date),
    ...items.map(item => "🎾 " + item.courtNo + "코트 · 🕒 " + item.startTime + "~" + item.endTime + " · " + (item.durationMinutes === 120 ? "연속 2시간" : "1시간")),
    "🔗 공식 예약 페이지", VENUES[first.venue]?.publicUrl,
    "운영자 계정 조회 결과입니다. 관내·관외 예약 자격을 확인하고 본인 계정으로 직접 예약하세요."].filter(Boolean).join("\n");
}
