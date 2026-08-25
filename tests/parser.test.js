import { describe, expect, it } from "vitest";
import { parseReservationTexts } from "../src/parser.js";
import { normalizeDate, normalizeTimeSlot } from "../src/normalization.js";

describe("parseReservationTexts", () => {
  it("normalizes available and reserved slots", () => {
    const rows = [
      "2026년 08월 24일 14:00~16:00 예약가능 (3)",
      "2026년 08월 24일 18:00~20:00 예약완료"
    ];

    expect(parseReservationTexts(rows, "gangil")).toEqual([
      {
        venue: "gangil",
        venueName: "강일테니스장",
        date: "2026-08-24",
        time: "14:00~16:00",
        available: true,
        availableCount: 3
      },
      {
        venue: "gangil",
        venueName: "강일테니스장",
        date: "2026-08-24",
        time: "18:00~20:00",
        available: false,
        availableCount: 0
      }
    ]);
  });
});

describe("reservation normalization", () => {
  it("keeps 2026-08-27 06:00~08:00 available", () => {
    expect(parseReservationTexts([
      "2026년 08월 27일 06:00~08:00 예약가능 (1)"
    ], "gangil")).toEqual([
      {
        venue: "gangil",
        venueName: "강일테니스장",
        date: "2026-08-27",
        time: "06:00~08:00",
        available: true,
        availableCount: 1
      }
    ]);
  });

  it("merges duplicate slots as available when reserved appears before available", () => {
    const rows = [
      "2026년 08월 27일 06:00~08:00 예약완료",
      "2026년 08월 27일 06:00~08:00 예약가능 (1)"
    ];

    expect(parseReservationTexts(rows, "gangil")[0]).toMatchObject({
      date: "2026-08-27",
      time: "06:00~08:00",
      available: true,
      availableCount: 1
    });
  });

  it("merges duplicate slots as available when available appears before reserved", () => {
    const rows = [
      "2026년 08월 27일 06:00~08:00 예약가능 (1)",
      "2026년 08월 27일 06:00~08:00 예약완료"
    ];

    expect(parseReservationTexts(rows, "gangil")[0]).toMatchObject({
      date: "2026-08-27",
      time: "06:00~08:00",
      available: true,
      availableCount: 1
    });
  });

  it("normalizes loose date and time strings", () => {
    expect(normalizeDate("2026-8-27")).toBe("2026-08-27");
    expect(normalizeDate("2026.08.27")).toBe("2026-08-27");
    expect(normalizeDate("2026년 8월 27일")).toBe("2026-08-27");
    expect(normalizeTimeSlot("6:00 ~ 8:00")).toBe("06:00~08:00");
  });
});
