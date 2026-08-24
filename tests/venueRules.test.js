import { describe, expect, it } from "vitest";
import { disabledVenueIdsForSelection, validateVenueSelection } from "../src/venueRules.js";

describe("validateVenueSelection", () => {
  it("allows Gangdong venues together", () => {
    expect(validateVenueSelection(["gangil", "myeongil"]).ok).toBe(true);
  });

  it("allows Gangdong and Songpa two-hour venues together", () => {
    expect(validateVenueSelection(["gangil", "songpa-oryun"]).ok).toBe(true);
    expect(validateVenueSelection(["myeongil", "songpa-songpa"]).ok).toBe(true);
  });

  it("allows all Songpa venues together", () => {
    expect(validateVenueSelection(["songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum"]).ok).toBe(true);
  });

  it("rejects mixed one-hour and two-hour venues", () => {
    expect(validateVenueSelection(["gangil", "olympic"]).ok).toBe(false);
    expect(validateVenueSelection(["songpa-oryun", "olympic"]).ok).toBe(false);
    expect(validateVenueSelection(["songpa-songpa", "olympic"]).message).toBe("예약단위가 다른 시설은 하나의 알림 조건으로 등록할 수 없습니다.");
  });
});

describe("disabledVenueIdsForSelection", () => {
  it("disables Olympic when a two-hour venue is selected", () => {
    expect(disabledVenueIdsForSelection(["gangil"])).toContain("olympic");
  });

  it("disables two-hour venues when Olympic is selected", () => {
    const disabled = disabledVenueIdsForSelection(["olympic"]);
    expect(disabled).toEqual(expect.arrayContaining(["gangil", "myeongil", "songpa-oryun", "songpa-ogeum"]));
  });

  it("enables everything when selection is empty", () => {
    expect(disabledVenueIdsForSelection([])).toEqual([]);
  });
});
