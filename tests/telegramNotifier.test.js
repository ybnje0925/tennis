import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOlympicAvailabilityMessage } from "../src/telegramNotifier.js";

const olympicSlot = {
  provider: "olympic",
  venue: "olympic",
  venueName: "올림픽공원 테니스장",
  courtType: "outdoor",
  courtTypeName: "실외",
  courtNo: "7",
  date: "2026-08-29",
  startTime: "18:00",
  endTime: "19:00",
  durationMinutes: 60
};

describe("buildOlympicAvailabilityMessage", () => {
  it("builds a one-hour Olympic alert", () => {
    const message = buildOlympicAvailabilityMessage(olympicSlot);

    expect(message).toContain("올림픽공원 테니스장 빈자리!");
    expect(message).toContain("7번 코트");
    expect(message).toContain("18:00~19:00");
  });
});

describe("sendTelegramMessage", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
    process.env.TELEGRAM_CHAT_ID = originalChatId;
    vi.resetModules();
  });

  it("uses an explicit user chat id when provided", async () => {
    vi.resetModules();
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_CHAT_ID = "global-chat";
    const { sendTelegramMessage: send } = await import("../src/telegramNotifier.js");
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true })
    }));

    await send("hello", { chatId: "user-chat" });

    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.chat_id).toBe("user-chat");
  });
});
