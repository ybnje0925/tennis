import { describe, expect, it } from "vitest";
import {
  filterHanamSlotsByWatch,
  hanamKeyFor,
  parseHanamDateStatusResponse,
  parseHanamTimeResponse,
  parseMisaReservationHtml
} from "../src/providers/hanamProvider.js";

const hanamAvailableResponse = {
  play_name: JSON.stringify([
    {
      play_name: "1코트",
      htmlx: `
        <li><span>18:00 ~ 19:00</span><span>예약가능</span></li>
        <li><span>19:00 ~ 20:00</span><span>예약완료</span></li>
      `
    }
  ]),
  rstate: "1"
};

function misaHtml(rows) {
  return `
    <table>
      <tbody id="dynamicTbody" class="text_center">
        ${rows}
      </tbody>
    </table>
  `;
}

function misaRow({ date = "2026-09-10", time, action }) {
  return `
    <tr>
      <td>${date}</td>
      <td>${time}</td>
      <td><div class="resveBtn"><a class="btn">${action}</a></div></td>
    </tr>
  `;
}

describe("Hanam sport parser", () => {
  it("parses an available one-hour target slot", () => {
    const slots = parseHanamTimeResponse(hanamAvailableResponse, "hanam-tennis-1", "2026-09-10");

    expect(slots).toMatchObject([
      { startTime: "18:00", endTime: "19:00", available: true },
      { startTime: "19:00", endTime: "20:00", available: false }
    ]);
  });

  it("parses multiple one-hour slots", () => {
    const slots = parseHanamTimeResponse(hanamAvailableResponse, "hanam-tennis-1", "2026-09-10");

    expect(slots.map((slot) => slot.time)).toEqual(["18:00~19:00", "19:00~20:00"]);
  });

  it("treats a closed date status as a parsed date, not an error", () => {
    const status = parseHanamDateStatusResponse({
      "2026-09-12": { rday2: "2026-09-12", t_cnt: "1", h_cnt: "0" }
    }, "2026-09-12");

    expect(status.t_cnt).toBe("1");
  });

  it("treats a holiday date status as a parsed date, not an error", () => {
    const status = parseHanamDateStatusResponse({
      "2026-09-25": { rday2: "2026-09-25", t_cnt: "0", h_cnt: "1" }
    }, "2026-09-25");

    expect(status.h_cnt).toBe("1");
  });

  it("throws on target date parsing failure instead of returning not available", () => {
    expect(() => parseHanamDateStatusResponse({
      "2026-09-11": { rday2: "2026-09-11", t_cnt: "0", h_cnt: "0" }
    }, "2026-09-10")).toThrow(/대상 날짜/);
  });

  it("throws when the time response shape changes", () => {
    expect(() => parseHanamTimeResponse({ ok: true }, "hanam-tennis-1", "2026-09-10")).toThrow(/play_name/);
  });
});

describe("Misa parser", () => {
  it("marks one court as available when the action is reservation", () => {
    const slots = parseMisaReservationHtml(misaHtml([
      misaRow({ time: "18:00 ~ 20:00", action: "예약하기" })
    ].join("")), { venueId: "misa-court-1", date: "2026-09-10", courtNo: "1" });

    expect(slots).toMatchObject([
      { courtNo: "1", time: "18:00~20:00", available: true }
    ]);
  });

  it("marks a completed court as not available", () => {
    const slots = parseMisaReservationHtml(misaHtml([
      misaRow({ time: "18:00 ~ 20:00", action: "예약완료" })
    ].join("")), { venueId: "misa-court-1", date: "2026-09-10", courtNo: "1" });

    expect(slots[0]).toMatchObject({ available: false });
  });

  it("supports all-court filtering when only one court is available", () => {
    const slots = [
      ...parseMisaReservationHtml(misaHtml(misaRow({ time: "18:00 ~ 20:00", action: "예약완료" })), { venueId: "misa-all", date: "2026-09-10", courtNo: "1" }),
      ...parseMisaReservationHtml(misaHtml(misaRow({ time: "18:00 ~ 20:00", action: "예약하기" })), { venueId: "misa-all", date: "2026-09-10", courtNo: "2" })
    ];
    const matches = filterHanamSlotsByWatch(slots, {
      venues: ["misa-all"],
      date: "2026-09-10",
      times: ["18:00~20:00"]
    });

    expect(matches.map((slot) => slot.courtNo)).toEqual(["2"]);
  });

  it("returns every available court for all-court watches", () => {
    const slots = [
      ...parseMisaReservationHtml(misaHtml(misaRow({ time: "18:00 ~ 20:00", action: "예약하기" })), { venueId: "misa-all", date: "2026-09-10", courtNo: "2" }),
      ...parseMisaReservationHtml(misaHtml(misaRow({ time: "18:00 ~ 20:00", action: "예약하기" })), { venueId: "misa-all", date: "2026-09-10", courtNo: "4" })
    ];
    const matches = filterHanamSlotsByWatch(slots, {
      venues: ["misa-all"],
      date: "2026-09-10",
      times: ["18:00~20:00"]
    });

    expect(matches.map((slot) => slot.courtNo)).toEqual(["2", "4"]);
  });

  it("does not match an open date when the target time is absent", () => {
    const slots = parseMisaReservationHtml(misaHtml(
      misaRow({ time: "14:00 ~ 16:00", action: "예약하기" })
    ), { venueId: "misa-court-1", date: "2026-09-10", courtNo: "1" });
    const matches = filterHanamSlotsByWatch(slots, {
      venues: ["misa-court-1"],
      date: "2026-09-10",
      times: ["18:00~20:00"]
    });

    expect(matches).toEqual([]);
  });

  it("throws on response structure changes", () => {
    expect(() => parseMisaReservationHtml("<main></main>", {
      venueId: "misa-court-1",
      date: "2026-09-10",
      courtNo: "1"
    })).toThrow(/tbody/);
  });

  it("dedupes by court in Hanam keys", () => {
    expect(hanamKeyFor({
      provider: "hanam",
      venue: "misa-all",
      courtNo: "2",
      date: "2026-09-10",
      startTime: "18:00",
      endTime: "20:00"
    })).not.toBe(hanamKeyFor({
      provider: "hanam",
      venue: "misa-all",
      courtNo: "4",
      date: "2026-09-10",
      startTime: "18:00",
      endTime: "20:00"
    }));
  });
});
