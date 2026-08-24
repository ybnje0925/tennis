import { describe, expect, it } from "vitest";
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
