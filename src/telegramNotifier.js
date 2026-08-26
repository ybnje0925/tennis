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
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  if (!response) {
    const cause = lastError?.cause?.code ? ` (${lastError.cause.code})` : "";
    throw new Error(`Telegram request failed${cause}: ${lastError?.message ?? "unknown error"}`);
  }

  if (!response.ok) {
    const detail = await readTelegramError(response);
    throw new Error(`Telegram send failed: ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  return response.json();
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

export function buildAvailabilityMessage(item) {
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
