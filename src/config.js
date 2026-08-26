import "dotenv/config";

const bool = (value, fallback) => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "y"].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function parsePollingMinutes(value, fallback = 5) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
}

const defaultPollingMinutes = 5;

export const config = {
  gangdongUserId: process.env.GANGDONG_USER_ID || "",
  gangdongUserPassword: process.env.GANGDONG_USER_PASSWORD || "",
  olympicUserId: process.env.OLYMPIC_USER_ID || "",
  olympicUserPassword: process.env.OLYMPIC_USER_PASSWORD || "",
  songpaUserId: process.env.SONGPA_USER_ID || "",
  songpaUserPassword: process.env.SONGPA_USER_PASSWORD || "",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || "",
  adminApiToken: process.env.ADMIN_API_TOKEN || "",
  legacyOwnerUserId: process.env.LEGACY_OWNER_USER_ID || "",
  dataDir: process.env.DATA_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/data` : "data"),
  sessionDir: process.env.SESSION_DIR || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/sessions` : "sessions"),
  enableTestTools: bool(process.env.ENABLE_TEST_TOOLS, false),
  enableOlympicProvider: bool(process.env.ENABLE_OLYMPIC_PROVIDER, true),
  headless: bool(process.env.HEADLESS, true),
  port: int(process.env.PORT, 3000),
  checkIntervalMinutes: parsePollingMinutes(process.env.CHECK_INTERVAL_MINUTES, defaultPollingMinutes),
  providerPollingMinutes: {
    gangdong: parsePollingMinutes(process.env.GANGDONG_POLLING_MINUTES, defaultPollingMinutes),
    songpa: parsePollingMinutes(process.env.SONGPA_POLLING_MINUTES, defaultPollingMinutes),
    olympic: parsePollingMinutes(process.env.OLYMPIC_POLLING_MINUTES, defaultPollingMinutes)
  }
};

export function assertLoginConfig() {
  if (!config.gangdongUserId || !config.gangdongUserPassword) {
    throw new Error("GANGDONG_USER_ID and GANGDONG_USER_PASSWORD are required for live checks.");
  }
}

export function assertOlympicLoginConfig() {
  if (!config.olympicUserId || !config.olympicUserPassword) {
    throw new Error("OLYMPIC_USER_ID and OLYMPIC_USER_PASSWORD are required for Olympic live checks.");
  }
}

export function assertSongpaLoginConfig() {
  if (!config.songpaUserId || !config.songpaUserPassword) {
    throw new Error("SONGPA_USER_ID and SONGPA_USER_PASSWORD are required for Songpa live checks.");
  }
}
