import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCycleSummary,
  buildVenueDateTargets,
  findNotifications,
  groupActiveWatchesByVenue,
  isProviderDue,
  isProviderWithinMonitoringHours,
  keyFor,
  nextFixedSlotAt,
  nextProviderMonitoringStartAt,
  resetSchedulerRuntimeForTests,
  runCheckCycle,
  syncProviderSchedule
} from "../src/monitor.js";
import { CHECK_META } from "../src/checker.js";
import { PROVIDERS } from "../src/constants.js";

beforeEach(() => {
  resetSchedulerRuntimeForTests();
});

function state(overrides = {}) {
  return {
    watches: [
      {
        id: "w1",
        userId: "u1",
        venues: ["gangil"],
        date: "2026-08-29",
        times: ["18:00~20:00"],
        enabled: true
      }
    ],
    users: [
      {
        id: "u1",
        name: "tester",
        telegramChatId: "chat-1",
        telegramConnected: true,
        enabled: true,
        createdAt: "2026-08-24T00:00:00.000Z"
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

  it("matches canonicalized watch and reservation keys", () => {
    const current = state({
      watches: [{
        id: "w1",
        userId: "u1",
        venues: ["gangil"],
        date: "2026-8-27",
        times: ["6:00 ~ 8:00"],
        enabled: true
      }]
    });

    const notifications = findNotifications(current, [
      slot({ date: "2026-08-27", time: "06:00~08:00" })
    ]);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].key).toBe("gangil|2026-08-27|06:00~08:00");
  });

  it("separates gangil and myeongil watches", () => {
    const current = state({
      watches: [{ id: "w2", userId: "u1", venues: ["myeongil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true }]
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
      userId: "u1",
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

function summaryLog(current) {
  return current.system.logs.find((line) => line.includes("조회완료"));
}

function withProviderPolling(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((providerId) => [providerId, PROVIDERS[providerId].pollingMinutes])
  );
  for (const [providerId, pollingMinutes] of Object.entries(values)) {
    PROVIDERS[providerId].pollingMinutes = pollingMinutes;
  }
  const restore = () => {
    for (const [providerId, pollingMinutes] of Object.entries(previous)) {
      PROVIDERS[providerId].pollingMinutes = pollingMinutes;
    }
  };
  try {
    const result = callback();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

describe("runCheckCycle active watch targeting", () => {
  function makeRunner(current, checker = vi.fn(async () => ({}))) {
    return {
      checker,
      notifier: vi.fn(),
      now: new Date("2026-08-24T10:00:00.000Z"),
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

  it("does not call providers on scheduler ticks when inactive providers are due", async () => {
    const current = state({
      watches: [],
      system: {
        lastCheckedAt: null,
        nextCheckAt: null,
        venues: {},
        providers: {
          gangdong: {
            id: "gangdong",
            active: false,
            pollingMinutes: 5,
            lastCheckedAt: "2026-08-24T09:00:00.000Z",
            nextCheckAt: null
          }
        },
        logs: []
      }
    });
    const runner = makeRunner(current);

    await runCheckCycle(runner);

    expect(runner.checker).not.toHaveBeenCalled();
  });

  it("deduplicates a provider with multiple active watches", async () => {
    const watches = [
      { id: "w1", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
      { id: "w2", userId: "u1", venues: ["gangil"], date: "2026-08-30", times: ["20:00~22:00"], enabled: true }
    ];
    const runner = makeRunner(state({ watches }));

    await runCheckCycle(runner);

    expect(runner.checker).toHaveBeenCalledTimes(1);
    expect(runner.checker.mock.calls[0][0].watches).toEqual(watches);
  });

  it("deduplicates the same date for a provider", () => {
    const watches = [
      { id: "w1", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
      { id: "w2", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["20:00~22:00"], enabled: true }
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

    expect(summaryLog(current)).toContain("조회완료 | 강동 1/1✓ | 빈자리 0건");
    expect(summaryLog(current)).not.toContain("결과 없음");
  });

  it("summarizes vacancies and sent alerts separately", async () => {
    const current = state();
    const checker = vi.fn(async () => ({
      gangil: [slot()]
    }));
    const notifier = vi.fn(async () => {});

    await runCheckCycle({ ...makeRunner(current, checker), notifier });

    expect(summaryLog(current)).toContain("빈자리 1건 → 알림 1건");
  });

  it("routes notifications to the matching user's Telegram chat only", async () => {
    const current = state({
      users: [
        { id: "u1", telegramChatId: "chat-a", telegramConnected: true, enabled: true },
        { id: "u2", telegramChatId: "chat-b", telegramConnected: true, enabled: true }
      ],
      watches: [
        { id: "wa", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
        { id: "wb", userId: "u2", venues: ["gangil"], date: "2026-08-29", times: ["10:00~12:00"], enabled: true }
      ]
    });
    const checker = vi.fn(async () => ({
      gangil: [slot({ time: "18:00~20:00" })]
    }));
    const notifier = vi.fn(async () => {});

    await runCheckCycle({ ...makeRunner(current, checker), notifier });

    expect(notifier).toHaveBeenCalledTimes(1);
    expect(notifier.mock.calls[0][1]).toBe("chat-a");
  });

  it("excludes disabled users from common provider checks and alerts", async () => {
    const current = state({
      users: [{ id: "u1", telegramChatId: "chat-a", telegramConnected: true, enabled: false }]
    });
    const runner = makeRunner(current);

    await runCheckCycle(runner);

    expect(runner.checker).not.toHaveBeenCalled();
  });

  it("does not check a provider outside its fixed wall-clock slot", async () => {
    const current = state({
      system: {
        lastCheckedAt: "2026-08-24T09:00:00.000Z",
        nextCheckAt: "2026-08-24T09:05:00.000Z",
        venues: {},
        providers: {
          gangdong: {
            id: "gangdong",
            active: true,
            pollingMinutes: 5,
            lastCheckedAt: new Date(Date.now() - 60_000).toISOString(),
            nextCheckAt: new Date(Date.now() + 4 * 60_000).toISOString()
          }
        },
        logs: []
      }
    });
    const runner = makeRunner(current);

    const result = await runCheckCycle({ ...runner, now: new Date("2026-08-24T10:01:00.000Z") });

    expect(result.notDue).toBe(true);
    expect(runner.checker).not.toHaveBeenCalled();
  });

  it("checks a provider on its fixed wall-clock slot", async () => {
    const current = state({
      system: {
        lastCheckedAt: "2026-08-24T09:00:00.000Z",
        nextCheckAt: "2026-08-24T09:05:00.000Z",
        venues: {},
        providers: {
          gangdong: {
            id: "gangdong",
            active: true,
            pollingMinutes: 5,
            lastCheckedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
            nextCheckAt: new Date(Date.now() - 60_000).toISOString()
          }
        },
        logs: []
      }
    });
    const runner = makeRunner(current);

    await runCheckCycle({ ...runner, now: new Date("2026-08-24T10:00:00.000Z") });

    expect(runner.checker).toHaveBeenCalledTimes(1);
  });

  it("keeps registration time from creating user-specific scheduler offsets", async () => {
    const watches = [
      { id: "a", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true, createdAt: "2026-08-24T10:51:00.000Z" },
      { id: "b", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["10:00~12:00"], enabled: true, createdAt: "2026-08-24T10:52:00.000Z" },
      { id: "c", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["20:00~22:00"], enabled: true, createdAt: "2026-08-24T10:53:00.000Z" }
    ];
    const current = state({ watches });
    const runner = makeRunner(current);

    await runCheckCycle({ ...runner, now: new Date("2026-08-24T09:54:00.000Z") });
    expect(runner.checker).not.toHaveBeenCalled();

    await runCheckCycle({ ...runner, now: new Date("2026-08-24T10:00:00.000Z") });
    expect(runner.checker).toHaveBeenCalledTimes(1);
    expect(runner.checker.mock.calls[0][0].watches).toHaveLength(3);
  });

  it("does not increase common provider checks for 100 users watching the same venue date", async () => {
    const users = Array.from({ length: 100 }, (_, index) => ({
      id: `u${index}`,
      telegramChatId: `chat-${index}`,
      telegramConnected: true,
      enabled: true
    }));
    const watches = users.map((user, index) => ({
      id: `w${index}`,
      userId: user.id,
      venues: ["gangil"],
      date: "2026-08-29",
      times: [index % 2 === 0 ? "18:00~20:00" : "10:00~12:00"],
      enabled: true
    }));
    const runner = makeRunner(state({ users, watches }));

    await runCheckCycle({ ...runner, now: new Date("2026-08-24T10:00:00.000Z") });

    expect(runner.checker).toHaveBeenCalledTimes(1);
  });

  it("deduplicates duplicate scheduler callbacks for the same provider slot", async () => {
    const current = state();
    const runner = makeRunner(current);
    const now = new Date("2026-08-24T10:00:00.000Z");

    await runCheckCycle({ ...runner, now });
    await runCheckCycle({ ...runner, now });

    expect(runner.checker).toHaveBeenCalledTimes(1);
  });

  it("does not start a second provider check while the previous slot is still in flight", async () => {
    let release;
    const checker = vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ gangil: [] });
    }));
    const current = state();
    const runner = makeRunner(current, checker);

    const first = runCheckCycle({ ...runner, now: new Date("2026-08-24T10:00:00.000Z") });
    await runCheckCycle({ ...runner, now: new Date("2026-08-24T10:10:00.000Z") });
    release();
    await first;

    expect(checker).toHaveBeenCalledTimes(1);
  });

  it("runs one pending provider check after a delayed 5-minute slot finishes", async () => {
    let releaseFirst;
    const checker = vi.fn(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ gangil: [] });
    }));
    checker.mockImplementationOnce(() => new Promise((resolve) => {
      releaseFirst = () => resolve({ gangil: [] });
    }));
    checker.mockImplementationOnce(async () => ({ gangil: [] }));
    const current = state();
    const runner = makeRunner(current, checker);

    const first = runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:00:00.000Z") });
    await runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:05:00.000Z") });

    expect(current.system.providers.gangdong.pending).toBe(true);
    expect(current.system.logs.filter((line) => line.includes("강동 조회 지연"))).toHaveLength(1);

    releaseFirst();
    await first;
    await vi.waitFor(() => expect(checker).toHaveBeenCalledTimes(2));
    expect(current.system.logs.some((line) => line.includes("강동 지연 조회 START"))).toBe(true);
  });

  it("coalesces multiple missed provider slots into one pending rerun", async () => {
    let releaseFirst;
    const checker = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = () => resolve({ gangil: [] });
      }))
      .mockImplementation(async () => ({ gangil: [] }));
    const current = state();
    const runner = makeRunner(current, checker);

    const first = runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:00:00.000Z") });
    await runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:05:00.000Z") });
    await runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:10:00.000Z") });
    await runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:15:00.000Z") });

    expect(current.system.logs.filter((line) => line.includes("강동 조회 지연"))).toHaveLength(1);

    releaseFirst();
    await first;
    await vi.waitFor(() => expect(checker).toHaveBeenCalledTimes(2));
  });

  it("keeps provider locks independent when Songpa is slow", async () => {
    let releaseSongpa;
    const watches = [
      { id: "g", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
      { id: "s", userId: "u1", venues: ["songpa-oryun"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
      { id: "o", userId: "u1", provider: "olympic", venues: ["olympic"], date: "2026-08-29", times: ["18:00~19:00"], enabled: true }
    ];
    const checker = vi.fn(({ watches }) => {
      if (watches.some((watch) => watch.id === "s")) {
        return new Promise((resolve) => {
          releaseSongpa = () => resolve({ "songpa-oryun": [] });
        });
      }
      if (watches.some((watch) => watch.id === "o")) return Promise.resolve({ olympic: [] });
      return Promise.resolve({ gangil: [] });
    });
    const current = state({ watches });
    const runner = makeRunner(current, checker);

    const songpa = runCheckCycle({ ...runner, targetProviderIds: ["songpa"], now: new Date("2026-08-24T12:00:00.000Z") });
    await runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:00:00.000Z") });
    await runCheckCycle({ ...runner, targetProviderIds: ["olympic"], now: new Date("2026-08-24T12:00:00.000Z") });

    expect(checker.mock.calls.map(([arg]) => arg.watches.map((watch) => watch.id).join(","))).toEqual(["s", "g", "o"]);
    releaseSongpa();
    await songpa;
  });

  it("releases the provider lock after checker errors", async () => {
    const checker = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ gangil: [] });
    const current = state();
    const runner = makeRunner(current, checker);

    await runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:00:00.000Z") });
    await runCheckCycle({ ...runner, targetProviderIds: ["gangdong"], now: new Date("2026-08-24T12:05:00.000Z") });

    expect(checker).toHaveBeenCalledTimes(2);
    expect(current.system.providers.gangdong.status).toBe("idle");
  });

  it("does not mark a provider as successful in logs when it was not due or checked", async () => {
    const current = state({
      watches: [
        { id: "g", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
        { id: "s", userId: "u1", venues: ["songpa-oryun"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
        { id: "o", userId: "u1", provider: "olympic", venues: ["olympic"], date: "2026-08-29", times: ["18:00~19:00"], enabled: true }
      ]
    });
    const checker = vi.fn(async ({ watches }) => {
      expect(watches.map((watch) => watch.id).sort()).toEqual(["g", "s"]);
      return {
        gangil: [slot({ available: false, availableCount: 0 })],
        "songpa-oryun": [slot({ venue: "songpa-oryun", venueName: "오륜테니스장", available: false, availableCount: 0 })]
      };
    });

    await withProviderPolling({ gangdong: 5, songpa: 5, olympic: 10 }, async () => {
      await runCheckCycle({ ...makeRunner(current, checker), now: new Date("2026-08-24T17:55:00.000Z") });

      expect(summaryLog(current)).toContain("강동 1/1✓");
      expect(summaryLog(current)).toContain("송파 1/1✓");
      expect(summaryLog(current)).not.toContain("올림픽✓");
    });
  });

  it("skips Olympic outside monitoring hours without sending it to the checker", async () => {
    const current = state({
      watches: [
        { id: "g", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
        { id: "s", userId: "u1", venues: ["songpa-oryun"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
        { id: "o", userId: "u1", provider: "olympic", venues: ["olympic"], date: "2026-08-29", times: ["18:00~19:00"], enabled: true }
      ]
    });
    const checker = vi.fn(async ({ watches }) => {
      expect(watches.map((watch) => watch.id).sort()).toEqual(["g", "s"]);
      return {
        gangil: [slot({ available: false, availableCount: 0 })],
        "songpa-oryun": [slot({ venue: "songpa-oryun", venueName: "오륜테니스장", available: false, availableCount: 0 })]
      };
    });

    await runCheckCycle({ ...makeRunner(current, checker), now: new Date("2026-08-25T23:30:00.000Z") });

    expect(checker).toHaveBeenCalledTimes(1);
    expect(summaryLog(current)).toContain("강동 1/1✓");
    expect(summaryLog(current)).toContain("송파 1/1✓");
    expect(summaryLog(current)).toContain("올림픽 SKIP(운영시간 외)");
  });

  it("checks Olympic during monitoring hours", async () => {
    const current = olympicState();
    const checker = vi.fn(async ({ watches }) => {
      expect(watches.map((watch) => watch.id)).toEqual(["w1"]);
      return { olympic: [] };
    });

    await runCheckCycle({ ...makeRunner(current, checker), now: new Date("2026-08-26T00:00:00.000Z") });

    expect(checker).toHaveBeenCalledTimes(1);
    expect(summaryLog(current)).toContain("올림픽✓");
  });

  it("stores scheduler run times from the same cycle clock used by logs", async () => {
    const current = state();
    const checker = vi.fn(async () => ({
      gangil: [slot({ available: false, availableCount: 0 })]
    }));

    await runCheckCycle({ ...makeRunner(current, checker), now: new Date("2026-08-26T00:50:00.000Z") });

    expect(summaryLog(current)).toContain("[09:50] 조회완료");
    expect(current.system.lastRunAt).toBe(current.system.lastRun.runFinishedAt);
    expect(current.system.nextRunAt).toBe("2026-08-26T00:55:00.000Z");
    expect(current.system.nextCheckAt).toBe(current.system.nextRunAt);
  });
});

describe("provider monitoring hours", () => {
  it("treats Olympic as outside hours before 09:00 KST", () => {
    expect(isProviderWithinMonitoringHours("olympic", new Date("2026-08-25T23:30:00.000Z"))).toBe(false);
    expect(nextProviderMonitoringStartAt("olympic", new Date("2026-08-25T23:30:00.000Z"))).toBe("2026-08-26T00:00:00.000Z");
  });

  it("treats Olympic as open from 09:00 KST", () => {
    expect(isProviderWithinMonitoringHours("olympic", new Date("2026-08-26T00:00:00.000Z"))).toBe(true);
    expect(isProviderWithinMonitoringHours("olympic", new Date("2026-08-26T14:59:00.000Z"))).toBe(true);
  });
});

describe("isProviderDue", () => {
  it("uses fixed wall-clock slots to decide due state", () => {
    const at1910 = new Date("2026-08-24T10:10:00.000Z");
    const at1915 = new Date("2026-08-24T10:15:00.000Z");

    withProviderPolling({ gangdong: 5, songpa: 5, olympic: 10 }, () => {
      expect(isProviderDue({ id: "gangdong", pollingMinutes: 10 }, at1910)).toBe(true);
      expect(isProviderDue({ id: "songpa", pollingMinutes: 10 }, at1910)).toBe(true);
      expect(isProviderDue({ id: "olympic", pollingMinutes: 5 }, at1910)).toBe(true);
      expect(isProviderDue({ id: "gangdong", pollingMinutes: 10 }, at1915)).toBe(true);
      expect(isProviderDue({ id: "songpa", pollingMinutes: 10 }, at1915)).toBe(true);
      expect(isProviderDue({ id: "olympic", pollingMinutes: 5 }, at1915)).toBe(false);
    });
  });

  it("runs all 5-minute providers on 00/05/10/15 wall-clock slots", () => {
    withProviderPolling({ gangdong: 5, songpa: 5, olympic: 5 }, () => {
      for (const providerId of ["gangdong", "songpa", "olympic"]) {
        expect(isProviderDue({ id: providerId }, new Date("2026-08-24T17:00:00.000Z"))).toBe(true);
        expect(isProviderDue({ id: providerId }, new Date("2026-08-24T17:05:00.000Z"))).toBe(true);
        expect(isProviderDue({ id: providerId }, new Date("2026-08-24T17:10:00.000Z"))).toBe(true);
        expect(isProviderDue({ id: providerId }, new Date("2026-08-24T17:11:00.000Z"))).toBe(false);
      }
    });
  });
});

describe("syncProviderSchedule", () => {
  it("sets nextCheckAt to 5 minutes after a 17:50 check slot", () => {
    const current = state();

    withProviderPolling({ gangdong: 5 }, () => {
      syncProviderSchedule(current, ["gangdong"], new Date("2026-08-24T17:50:00.000Z"));
    });

    expect(current.system.providers.gangdong.pollingMinutes).toBe(5);
    expect(current.system.providers.gangdong.nextCheckAt).toBe("2026-08-24T17:55:00.000Z");
    expect(current.system.nextCheckAt).toBe("2026-08-24T17:55:00.000Z");
  });

  it("sets nextCheckAt to 18:00 after a 17:55 check slot", () => {
    const current = state();

    withProviderPolling({ gangdong: 5 }, () => {
      syncProviderSchedule(current, ["gangdong"], new Date("2026-08-24T17:55:00.000Z"));
    });

    expect(current.system.providers.gangdong.nextCheckAt).toBe("2026-08-24T18:00:00.000Z");
    expect(current.system.nextCheckAt).toBe("2026-08-24T18:00:00.000Z");
  });

  it("overwrites stale state polling and stale nextCheckAt from current runtime provider config", () => {
    const current = state({
      system: {
        lastCheckedAt: null,
        nextCheckAt: "2026-08-24T18:00:00.000Z",
        venues: {},
        logs: [],
        providers: {
          gangdong: {
            id: "gangdong",
            active: true,
            pollingMinutes: 10,
            lastCheckedAt: "2026-08-24T17:50:00.000Z",
            nextCheckAt: "2026-08-24T18:00:00.000Z"
          }
        }
      }
    });

    withProviderPolling({ gangdong: 5 }, () => {
      syncProviderSchedule(current, ["gangdong"], new Date("2026-08-24T17:50:00.000Z"));
    });

    expect(current.system.providers.gangdong.pollingMinutes).toBe(5);
    expect(current.system.providers.gangdong.nextCheckAt).toBe("2026-08-24T17:55:00.000Z");
    expect(current.system.nextCheckAt).toBe("2026-08-24T17:55:00.000Z");
  });

  it("does not revive a persisted pending flag after process restart", () => {
    const current = state({
      system: {
        lastCheckedAt: null,
        nextCheckAt: null,
        venues: {},
        logs: [],
        providers: {
          gangdong: {
            id: "gangdong",
            active: true,
            pollingMinutes: 5,
            pending: true,
            status: "pending",
            lastCheckedAt: "2026-08-24T17:50:00.000Z",
            nextCheckAt: "2026-08-24T17:55:00.000Z"
          }
        }
      }
    });

    syncProviderSchedule(current, ["gangdong"], new Date("2026-08-24T17:50:00.000Z"));

    expect(current.system.providers.gangdong.pending).toBe(false);
    expect(current.system.providers.gangdong.status).toBe("idle");
  });

  it("tracks mixed provider polling independently and avoids a misleading aggregate next time", () => {
    const current = state();

    withProviderPolling({ gangdong: 5, songpa: 5, olympic: 10 }, () => {
      syncProviderSchedule(current, ["gangdong", "songpa", "olympic"], new Date("2026-08-24T00:45:00.000Z"));

      expect(current.system.providers.gangdong).toMatchObject({
        pollingMinutes: 5,
        nextCheckAt: "2026-08-24T00:50:00.000Z"
      });
      expect(current.system.providers.songpa).toMatchObject({
        pollingMinutes: 5,
        nextCheckAt: "2026-08-24T00:50:00.000Z"
      });
      expect(current.system.providers.olympic).toMatchObject({
        pollingMinutes: 10,
        nextCheckAt: "2026-08-24T00:50:00.000Z"
      });
      expect(current.system.nextCheckAt).toBe("2026-08-24T00:50:00.000Z");

      syncProviderSchedule(current, ["gangdong", "songpa", "olympic"], new Date("2026-08-24T00:50:00.000Z"));
      expect(current.system.providers.gangdong.nextCheckAt).toBe("2026-08-24T00:55:00.000Z");
      expect(current.system.providers.songpa.nextCheckAt).toBe("2026-08-24T00:55:00.000Z");
      expect(current.system.providers.olympic.nextCheckAt).toBe("2026-08-24T01:00:00.000Z");
      expect(current.system.nextCheckAt).toBeNull();
    });
  });
});

describe("nextFixedSlotAt", () => {
  it("calculates the next absolute wall-clock slot", () => {
    expect(nextFixedSlotAt(new Date("2026-08-24T10:01:00.000Z"), 5)).toBe("2026-08-24T10:05:00.000Z");
    expect(nextFixedSlotAt(new Date("2026-08-24T10:04:00.000Z"), 5)).toBe("2026-08-24T10:05:00.000Z");
    expect(nextFixedSlotAt(new Date("2026-08-24T10:05:01.000Z"), 5)).toBe("2026-08-24T10:10:00.000Z");
    expect(nextFixedSlotAt(new Date("2026-08-24T10:56:00.000Z"), 5)).toBe("2026-08-24T11:00:00.000Z");
  });

  it("sets the next check from restart time to the next fixed slot", () => {
    expect(nextFixedSlotAt(new Date("2026-08-24T10:52:00.000Z"), 5)).toBe("2026-08-24T10:55:00.000Z");
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
    })).toBe("조회완료 | 송파 3/4△ | 확인된 빈자리 0건");
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
    })).toBe("조회완료 | 올림픽✕(날짜조회 실패) | 확인된 빈자리 0건");
  });

  it("keeps the normal vacancy label when every active provider succeeds with no slots", () => {
    expect(buildCycleSummary({
      checked: {
        gangil: [],
        myeongil: []
      },
      activeVenueIds: ["gangil", "myeongil"],
      vacancyCount: 0,
      alertCount: 0
    })).toBe("조회완료 | 강동 2/2✓ | 빈자리 0건");
  });
});
