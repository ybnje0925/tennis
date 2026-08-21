import { describe, expect, it } from "vitest";
import { parseReservationTexts } from "../src/parser.js";

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
