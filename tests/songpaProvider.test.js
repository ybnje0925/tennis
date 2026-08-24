import { describe, expect, it } from "vitest";
import { parseSongpaCalendarSnapshot, parseSongpaSlotText } from "../src/providers/songpaProvider.js";

describe("parseSongpaSlotText", () => {
  it("calculates available count from reserved/total display", () => {
    expect(parseSongpaSlotText("10:00~12:00예약가능 (2/3)")).toMatchObject({
      startTime: "10:00",
      endTime: "12:00",
      available: true,
      reservedCount: 2,
      totalCount: 3,
      availableCount: 1
    });
  });

  it("handles full availability display", () => {
    expect(parseSongpaSlotText("12:00~14:00예약가능 (0/3)")).toMatchObject({
      available: true,
      availableCount: 3
    });
  });

  it("marks completed slots unavailable", () => {
    expect(parseSongpaSlotText("18:00~20:00예약완료")).toMatchObject({
      available: false,
      availableCount: undefined
    });
  });
});

describe("parseSongpaCalendarSnapshot", () => {
  it("normalizes Songpa calendar cells", () => {
    const result = parseSongpaCalendarSnapshot({
      year: "2026",
      month: "08",
      cells: [{
        text: "25 10:00~12:00예약가능 (2/3) 18:00~20:00예약완료",
        slots: [
          { text: "10:00~12:00예약가능 (2/3)" },
          { text: "18:00~20:00예약완료" }
        ]
      }]
    }, "songpa-oryun");

    expect(result).toMatchObject([
      {
        provider: "songpa",
        venue: "songpa-oryun",
        venueName: "오륜테니스장",
        date: "2026-08-25",
        time: "10:00~12:00",
        durationMinutes: 120,
        available: true,
        availableCount: 1
      },
      {
        date: "2026-08-25",
        time: "18:00~20:00",
        available: false
      }
    ]);
  });
});
