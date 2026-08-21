import "dotenv/config";

const bool = (value, fallback) => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  gangdongUserId: process.env.GANGDONG_USER_ID || "",
  gangdongUserPassword: process.env.GANGDONG_USER_PASSWORD || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  enableTestTools: bool(process.env.ENABLE_TEST_TOOLS, false),
  headless: bool(process.env.HEADLESS, true),
  port: int(process.env.PORT, 3000),
  checkIntervalMinutes: int(process.env.CHECK_INTERVAL_MINUTES, 10)
};

export function assertLoginConfig() {
  if (!config.gangdongUserId || !config.gangdongUserPassword) {
    throw new Error("GANGDONG_USER_ID and GANGDONG_USER_PASSWORD are required for live checks.");
  }
}
