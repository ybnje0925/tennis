import { describe, expect, it } from "vitest";
import { findNotifications } from "../src/monitor.js";

describe("findNotifications", () => {
  it("notifies once when a matching slot is available", () => {
    const state = {
      watches: [{ id: "w1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"] }],
      lastAvailability: {},
      sentNotifications: {}
    };
    const reservations = [
      {
        venue: "gangil",
        venueName: "강일테니스장",
        date: "2026-08-29",
        time: "18:00~20:00",
        available: true,
        availableCount: 1
      }
    ];

    expect(findNotifications(state, reservations)).toHaveLength(1);
    state.sentNotifications["w1|gangil|2026-08-29|18:00~20:00"] = new Date().toISOString();
    expect(findNotifications(state, reservations)).toHaveLength(0);
  });
});
