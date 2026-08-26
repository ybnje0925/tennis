import { describe, expect, it } from "vitest";
import {
  dateOnlyToKstDate,
  formatKoreanDateWithWeekday,
  formatKoreanFullDateWithWeekday
} from "../public/dateFormat.js";

describe("shared Korean date formatting", () => {
  it("formats dates with Korean weekday", () => {
    expect(formatKoreanDateWithWeekday("2026-08-27")).toBe("8월 27일 (목)");
    expect(formatKoreanDateWithWeekday("2026-08-28")).toBe("8월 28일 (금)");
    expect(formatKoreanDateWithWeekday("2026-08-29")).toBe("8월 29일 (토)");
    expect(formatKoreanDateWithWeekday("2026-08-30")).toBe("8월 30일 (일)");
  });

  it("can include the year when needed", () => {
    expect(formatKoreanFullDateWithWeekday("2026-08-28")).toBe("2026년 8월 28일 (금)");
  });

  it("anchors date-only values to KST midnight", () => {
    expect(dateOnlyToKstDate("2026-08-28").toISOString()).toBe("2026-08-27T15:00:00.000Z");
    expect(formatKoreanDateWithWeekday("2026-08-28")).toBe("8월 28일 (금)");
  });
});
