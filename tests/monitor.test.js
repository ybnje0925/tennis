import { describe, expect, it } from "vitest";
import { findNotifications, keyFor } from "../src/monitor.js";

function state(overrides = {}) {
  return {
    watches: [
      {
        id: "w1",
        venues: ["gangil"],
        date: "2026-08-29",
        times: ["18:00~20:00"],
        enabled: true
      }
    ],
    lastAvailability: {},
    sentNotifications: {},
    ...overrides
  };
}

function slot(overrides = {}) {
  return {
    venue: "gangil",
    venueName: "강일테니스장",
    date: "2026-08-29",
    time: "18:00~20:00",
    available: true,
    availableCount: 1,
    ...overrides
  };
}

describe("findNotifications", () => {
  it("notifies when availability changes from false to true", () => {
    const item = slot();
    const current = state({
      lastAvailability: {
        [keyFor(item)]: { available: false }
      }
    });

    expect(findNotifications(current, [item])).toHaveLength(1);
  });

  it("does not duplicate notifications while availability stays true", () => {
    const item = slot();
    const current = state({
      lastAvailability: {
        [keyFor(item)]: { available: true }
      },
      sentNotifications: {
        [`w1|${keyFor(item)}`]: "2026-08-22T00:00:00.000Z"
      }
    });

    expect(findNotifications(current, [item])).toHaveLength(0);
  });

  it("notifies again after true to false to true", () => {
    const item = slot();
    const current = state({
      lastAvailability: {
        [keyFor(item)]: { available: false }
      },
      sentNotifications: {
        [`w1|${keyFor(item)}`]: "2026-08-22T00:00:00.000Z"
      }
    });

    expect(findNotifications(current, [item])).toHaveLength(1);
  });

  it("separates different dates and times", () => {
    expect(findNotifications(state(), [slot({ date: "2026-08-30" })])).toHaveLength(0);
    expect(findNotifications(state(), [slot({ time: "20:00~22:00" })])).toHaveLength(0);
  });

  it("separates gangil and myeongil watches", () => {
    const current = state({
      watches: [{ id: "w2", venues: ["myeongil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true }]
    });

    expect(findNotifications(current, [slot({ venue: "gangil" })])).toHaveLength(0);
    expect(findNotifications(current, [slot({ venue: "myeongil", venueName: "명일테니스장" })])).toHaveLength(1);
  });

  it("does not notify after a watch is deleted or disabled", () => {
    expect(findNotifications(state({ watches: [] }), [slot()])).toHaveLength(0);
    expect(findNotifications(state({ watches: [{ ...state().watches[0], enabled: false }] }), [slot()])).toHaveLength(0);
  });

  it("notifies Olympic availability once while it stays open", () => {
    const item = olympicSlot();
    const current = olympicState();
    const first = findNotifications(current, [item]);
    expect(first).toHaveLength(1);

    current.lastAvailability[first[0].key] = { available: true };
    current.sentNotifications[`w1|${first[0].key}`] = "2026-08-22T00:00:00.000Z";
    expect(findNotifications(current, [item])).toHaveLength(0);
  });

  it("renotifies Olympic availability after it closes and reopens", () => {
    const item = olympicSlot();
    const current = olympicState();
    const key = "olympic|outdoor|3|2026-08-29|18:00|19:00";
    current.lastAvailability[key] = { available: true };
    current.sentNotifications[`w1|${key}`] = "2026-08-22T00:00:00.000Z";

    expect(findNotifications(current, [])).toHaveLength(0);
    expect(current.lastAvailability[key].available).toBe(false);
    expect(findNotifications(current, [item])).toHaveLength(1);
  });
});

function olympicState() {
  return state({
    watches: [{
      id: "w1",
      provider: "olympic",
      venues: ["olympic"],
      date: "2026-08-29",
      times: ["18:00~19:00"],
      enabled: true
    }]
  });
}

function olympicSlot() {
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
    available: true
  };
}
