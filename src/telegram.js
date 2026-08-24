import {
  buildAvailabilityMessage,
  canSendTelegram,
  sendTelegramMessage
} from "./telegramNotifier.js";

export { canSendTelegram };

export async function sendTelegram(message, chatId) {
  return sendTelegramMessage(message, chatId ? { chatId } : {});
}

export function buildNotificationMessage(item) {
  return buildAvailabilityMessage(item);
}
