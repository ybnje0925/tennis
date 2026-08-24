import { describe, expect, it } from "vitest";
import {
  filterOlympicSlotsByWatch,
  parseOlympicCourtElements,
  parseOlympicTimeSlotElements
} from "../src/providers/olympicProvider.js";

const base = {
  date: "2026-08-29",
  courtType: "outdoor",
  startTime: "18:00",
  endTime: "19:00"
};

function slot(overrides = {}) {
  return {
    provider: "olympic",
    venue: "olympic",
    venueName: "올림픽공원 테니스장",
    courtType: "outdoor",
    courtTypeName: "실외",
    courtNo: "3",
    date: "2026-08-29",
    startTime: "18:00",
    endTime: "19:00",
    time: "18:00~19:00",
    durationMinutes: 60,
    available: true,
    ...overrides
  };
}

describe("Olympic court parsing", () => {
  it("parses one court for one time", () => {
    expect(parseOlympicCourtElements([{ text: "3번 코트 신청가능", className: "available" }], base)).toMatchObject([
      { courtNo: "3", courtType: "outdoor", startTime: "18:00", endTime: "19:00", available: true }
    ]);
  });

  it("parses multiple courts for one time", () => {
    const courts = parseOlympicCourtElements([
      { text: "3번 코트 신청가능", className: "available" },
      { text: "7번 코트 선택가능", className: "on" },
      { text: "11번 코트 예약가능", className: "active" }
    ], base);

    expect(courts.map((item) => item.courtNo)).toEqual(["3", "7", "11"]);
  });

  it("does not mark a time available when no court is actually available", () => {
    const timeSlots = parseOlympicTimeSlotElements([
      { text: "18:00~19:00 신청가능", className: "available" }
    ], { date: base.date, courtType: base.courtType });
    const courts = parseOlympicCourtElements([
      { text: "3번 코트 신청마감", className: "disabled" },
      { text: "7번 코트 선택불가", className: "off" }
    ], base);

    expect(timeSlots[0].available).toBe(true);
    expect(courts).toEqual([]);
  });

  it("matches selected Olympic time slots across court types", () => {
    const matches = filterOlympicSlotsByWatch([
      slot({ courtType: "outdoor", courtTypeName: "실외" }),
      slot({ courtType: "indoor", courtTypeName: "실내", courtNo: "4" })
    ], {
      provider: "olympic",
      date: "2026-08-29",
      times: ["18:00~19:00"]
    });

    expect(matches.map((item) => item.courtNo)).toEqual(["3", "4"]);
  });

  it("matches only selected one-hour Olympic time slots", () => {
    const matches = filterOlympicSlotsByWatch([
      slot({ courtNo: "3", startTime: "06:00", endTime: "07:00", time: "06:00~07:00" }),
      slot({ courtNo: "7", startTime: "21:00", endTime: "22:00", time: "21:00~22:00" }),
      slot({ courtNo: "9", startTime: "18:00", endTime: "19:00", time: "18:00~19:00" })
    ], {
      provider: "olympic",
      date: "2026-08-29",
      times: ["06:00~07:00", "21:00~22:00"]
    });

    expect(matches.map((item) => item.courtNo)).toEqual(["3", "7"]);
  });
});
