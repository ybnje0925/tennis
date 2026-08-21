import { buildTelegramTestMessage, sendTelegramMessage } from "./telegramNotifier.js";

sendTelegramMessage(buildTelegramTestMessage())
  .then(() => {
    console.log("Telegram message sent successfully");
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
