import { describe, expect, it } from "vitest";
import { parseLegacyCalendarHtml } from "../src/legacyHttpParser.js";

describe("legacy HTTP calendar parser", () => {
  it("parses Gangdong-style server-rendered slots", () => {
    const html = `
      <div class="calendar1_yearmonth"><strong>2026 . 09</strong></div>
      <div class="calendar1_table"><table><tr>
        <td><h6>16</h6><ul><li>06:00~08:00 예약완료</li><li>14:00~16:00 예약가능 (4)</li></ul></td>
      </tr></table></div>`;
    const rows = parseLegacyCalendarHtml(html, "gangil", "gangdong");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ date: "2026-09-16", time: "14:00~16:00", available: true, availableCount: 4 });
  });

  it("parses Songpa counts and reservation status", () => {
    const html = `
      <div class="calendar1_yearmonth"><strong>2026 . 09</strong></div>
      <div class="calendar1_table"><table><tr>
        <td>16<ul><li>08:00~10:00예약가능 (1/3)</li><li>10:00~12:00예약완료</li></ul></td>
      </tr></table></div>`;
    const rows = parseLegacyCalendarHtml(html, "songpa-oryun", "songpa");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-09-16", available: true, availableCount: 1 });
    expect(rows[1].available).toBe(false);
  });
});

