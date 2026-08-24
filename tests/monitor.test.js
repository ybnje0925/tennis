import { describe, expect, it, vi } from "vitest";
import { buildCycleSummary, buildVenueDateTargets, findNotifications, groupActiveWatchesByVenue, keyFor, runCheckCycle } from "../src/monitor.js";
import { CHECK_META } from "../src/checker.js";

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
    system: {
      lastCheckedAt: null,
      nextCheckAt: null,
      venues: {},
      logs: []
    },
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

describe("runCheckCycle active watch targeting", () => {
  function makeRunner(current, checker = vi.fn(async () => ({}))) {
    return {
      checker,
      notifier: vi.fn(),
      stateLoader: vi.fn(async () => current),
      stateSaver: vi.fn(async (next) => {
        current = next;
      })
    };
  }

  it("does not call providers when there are no watches", async () => {
    const runner = makeRunner(state({ watches: [] }));

    const result = await runCheckCycle(runner);

    expect(runner.checker).not.toHaveBeenCalled();
    expect(result.skipped).toBe(true);
  });

  it("does not call providers when all watches are disabled", async () => {
    const runner = makeRunner(state({ watches: [{ ...state().watches[0], enabled: false }] }));

    await runCheckCycle(runner);

    expect(runner.checker).not.toHaveBeenCalled();
  });

  it("targets one active provider once", async () => {
    const checker = vi.fn(async ({ watches }) => ({
      gangil: [slot({ date: watches[0].date, available: false, availableCount: 0 })]
    }));
    const runner = makeRunner(state(), checker);

    await runCheckCycle(runner);

    expect(checker).toHaveBeenCalledTimes(1);
    expect(checker).toHaveBeenCalledWith({ watches: state().watches, source: "scheduler" });
  });

  it("deduplicates a provider with multiple active watches", async () => {
    const watches = [
      { id: "w1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
      { id: "w2", venues: ["gangil"], date: "2026-08-30", times: ["20:00~22:00"], enabled: true }
    ];
    const runner = makeRunner(state({ watches }));

    await runCheckCycle(runner);

    expect(runner.checker).toHaveBeenCalledTimes(1);
    expect(runner.checker.mock.calls[0][0].watches).toEqual(watches);
  });

  it("deduplicates the same date for a provider", () => {
    const watches = [
      { id: "w1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
      { id: "w2", venues: ["gangil"], date: "2026-08-29", times: ["20:00~22:00"], enabled: true }
    ];

    expect(buildVenueDateTargets(groupActiveWatchesByVenue(watches))).toEqual({ gangil: ["2026-08-29"] });
  });

  it("stops checking on the next cycle after a watch is turned off", async () => {
    const current = state();
    const runner = makeRunner(current);

    await runCheckCycle(runner);
    current.watches[0].enabled = false;
    await runCheckCycle(runner);

    expect(runner.checker).toHaveBeenCalledTimes(1);
  });

  it("resumes checking on the next cycle after a watch is turned back on", async () => {
    const current = state({ watches: [{ ...state().watches[0], enabled: false }] });
    const runner = makeRunner(current);

    await runCheckCycle(runner);
    current.watches[0].enabled = true;
    await runCheckCycle(runner);

    expect(runner.checker).toHaveBeenCalledTimes(1);
  });

  it("stops checking on the next cycle after a watch is deleted", async () => {
    const current = state();
    const runner = makeRunner(current);

    await runCheckCycle(runner);
    current.watches = [];
    await runCheckCycle(runner);

    expect(runner.checker).toHaveBeenCalledTimes(1);
  });

  it("writes one summary UI log per successful cycle", async () => {
    const current = state();
    const checker = vi.fn(async () => ({
      gangil: [slot({ available: false, availableCount: 0 })]
    }));
    const notifier = vi.fn();

    await runCheckCycle({ ...makeRunner(current, checker), notifier });

    expect(current.system.logs).toHaveLength(1);
    expect(current.system.logs[0]).toContain("조회완료 | 강동 1/1✓ | 빈자리 0건");
    expect(current.system.logs[0]).not.toContain("결과 없음");
  });

  it("summarizes vacancies and sent alerts separately", async () => {
    const current = state();
    const checker = vi.fn(async () => ({
      gangil: [slot()]
    }));
    const notifier = vi.fn(async () => {});

    await runCheckCycle({ ...makeRunner(current, checker), notifier });

    expect(current.system.logs[0]).toContain("빈자리 1건 → 알림 1건");
  });
});

describe("buildCycleSummary", () => {
  it("formats all-provider success in one line", () => {
    expect(buildCycleSummary({
      checked: {
        gangil: [],
        myeongil: [],
        "songpa-oryun": [],
        "songpa-seongnaecheon": [],
        "songpa-songpa": [],
        "songpa-ogeum": [],
        olympic: []
      },
      activeVenueIds: ["gangil", "myeongil", "songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum", "olympic"],
      vacancyCount: 0,
      alertCount: 0
    })).toBe("조회완료 | 강동 2/2✓ | 송파 4/4✓ | 올림픽✓ | 빈자리 0건");
  });

  it("formats partial Songpa success", () => {
    const checked = {
      "songpa-oryun": [],
      "songpa-seongnaecheon": [],
      "songpa-songpa": []
    };
    Object.defineProperty(checked, CHECK_META, {
      value: { errors: [{ provider: "songpa", venueId: "songpa-ogeum", message: "DOM parse failed" }] },
      enumerable: false
    });

    expect(buildCycleSummary({
      checked,
      activeVenueIds: ["songpa-oryun", "songpa-seongnaecheon", "songpa-songpa", "songpa-ogeum"],
      vacancyCount: 0,
      alertCount: 0
    })).toBe("조회완료 | 송파 3/4△ | 빈자리 0건");
  });

  it("formats Olympic failure with a short reason", () => {
    const checked = {};
    Object.defineProperty(checked, CHECK_META, {
      value: { errors: [{ provider: "olympic", message: "Olympic date selector not found for 2026-08-29" }] },
      enumerable: false
    });

    expect(buildCycleSummary({
      checked,
      activeVenueIds: ["olympic"],
      vacancyCount: 0,
      alertCount: 0
    })).toBe("조회완료 | 올림픽✕(날짜조회 실패) | 빈자리 0건");
  });
});
