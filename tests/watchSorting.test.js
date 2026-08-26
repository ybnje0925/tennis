import { describe, expect, it } from "vitest";
import { sortWatchesByReservationTime } from "../public/watchSorting.js";

describe("sortWatchesByReservationTime", () => {
  it("sorts by reservation date and then earliest start time without mutating input", () => {
    const watches = [
      { id: "sep12", date: "2026-09-12", times: ["06:00~08:00"] },
      { id: "aug28", date: "2026-08-28", times: ["20:00~21:00"] },
      { id: "sep5-late", date: "2026-09-05", times: ["20:00~22:00"] },
      { id: "sep5-early", date: "2026-09-05", times: ["06:00~08:00"] }
    ];

    const sorted = sortWatchesByReservationTime(watches);

    expect(sorted.map((watch) => watch.id)).toEqual(["aug28", "sep5-early", "sep5-late", "sep12"]);
    expect(watches.map((watch) => watch.id)).toEqual(["sep12", "aug28", "sep5-late", "sep5-early"]);
  });
});
