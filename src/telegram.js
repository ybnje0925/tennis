import {
  buildAvailabilityMessage,
  canSendTelegram,
  sendTelegramMessage
} from "./telegramNotifier.js";

export { canSendTelegram };

export async function sendTelegram(message) {
  return sendTelegramMessage(message);
}

export function buildNotificationMessage(item) {
  return buildAvailabilityMessage(item);
}
