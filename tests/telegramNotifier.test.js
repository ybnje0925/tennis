import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAggregatedAvailabilityMessage,
  buildAvailabilityMessage,
  buildOlympicAvailabilityMessage
} from "../src/telegramNotifier.js";
import { formatKoreanDateWithWeekday } from "../public/dateFormat.js";

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

describe("formatKoreanDateWithWeekday", () => {
  it("formats reservation dates with Korean weekday in KST", () => {
    expect(formatKoreanDateWithWeekday("2026-08-27")).toBe("2026-08-27 (목)");
    expect(formatKoreanDateWithWeekday("2026-08-29")).toBe("2026-08-29 (토)");
    expect(formatKoreanDateWithWeekday("2026-08-30")).toBe("2026-08-30 (일)");
  });
});

describe("buildAvailabilityMessage", () => {
  it("includes the weekday for standard venue alerts", () => {
    const message = buildAvailabilityMessage({
      provider: "gangdong",
      venue: "gangil",
      venueName: "강일테니스장",
      date: "2026-08-27",
      time: "06:00~08:00",
      availableCount: 1
    });

    expect(message).toContain("2026-08-27 (목)");
    expect(message).toContain("06:00~08:00");
  });
});

describe("buildAggregatedAvailabilityMessage", () => {
  it("aggregates multiple Misa court slots into one message", () => {
    const message = buildAggregatedAvailabilityMessage([
      {
        provider: "hanam",
        facilityGroup: "misa",
        venue: "misa-all",
        venueName: "미사한강공원 테니스장 전체 코트",
        courtNo: "2",
        date: "2026-09-10",
        startTime: "18:00",
        endTime: "20:00"
      },
      {
        provider: "hanam",
        facilityGroup: "misa",
        venue: "misa-all",
        venueName: "미사한강공원 테니스장 전체 코트",
        courtNo: "4",
        date: "2026-09-10",
        startTime: "20:00",
        endTime: "22:00"
      }
    ]);

    expect(message).toContain("미사한강공원 테니스장 빈자리!");
    expect(message).toContain("2026-09-10 (목)");
    expect(message).toContain("- 2코트 18:00~20:00");
    expect(message).toContain("- 4코트 20:00~22:00");
  });
});

describe("buildOlympicAvailabilityMessage", () => {
  it("builds a one-hour Olympic alert", () => {
    const message = buildOlympicAvailabilityMessage(olympicSlot);

    expect(message).toContain("올림픽공원 테니스장 빈자리!");
    expect(message).toContain("7번 코트");
    expect(message).toContain("2026-08-29 (토)");
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
