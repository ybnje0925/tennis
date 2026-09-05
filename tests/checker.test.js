import { beforeEach, describe, expect, it, vi } from "vitest";

const openGangdongSession = vi.fn();
const looksLikeProtectionOrLogin = vi.fn(async () => false);
const checkHanamVenues = vi.fn(async () => ({}));
const parseReservationDom = vi.fn(async () => [
  {
    venue: "gangil",
    venueName: "강일테니스장",
    date: "2026-08-29",
    time: "18:00~20:00",
    available: false,
    availableCount: 0
  },
  {
    venue: "gangil",
    venueName: "강일테니스장",
    date: "2026-08-30",
    time: "18:00~20:00",
    available: false,
    availableCount: 0
  }
]);

function makeCalendarPage(initialMonth = "2026-08", options = {}) {
  const page = {
    month: initialMonth,
    missingDates: new Set(options.missingDates || []),
    slotCounts: options.slotCounts || {},
    goto: vi.fn(async (url = "") => {
      const venueId = String(url).includes("s02.") ? "myeongil" : "gangil";
      page.missingDates = new Set(options.missingDatesByVenue?.[venueId] || options.missingDates || []);
      page.slotCounts = options.slotCountsByVenue?.[venueId] || options.slotCounts || {};
    }),
    evaluate: vi.fn(async () => ({
      yearMonth: page.month,
      dates: Array.from({ length: daysInMonth(page.month) }, (_, index) => {
        const date = `${page.month}-${String(index + 1).padStart(2, "0")}`;
        if (page.missingDates.has(date)) return null;
        return {
          date,
          present: true,
          slotElementCount: page.slotCounts[date] ?? 1,
          reservationStatusCount: page.slotCounts[date] ?? 1
        };
      }).filter(Boolean)
    })),
    waitForLoadState: vi.fn(async () => {}),
    waitForFunction: vi.fn(async (fn, targetMonth) => {
      if (page.month !== targetMonth) throw new Error(`month did not change to ${targetMonth}`);
    }),
    locator: vi.fn((selector) => ({
      first: () => ({
        innerText: vi.fn(async () => page.month.replace("-", " . ")),
        getAttribute: vi.fn(async () => {
          if (selector.includes("다음달")) return `/page/rent/s01.od.list.php?sch_sym=${addMonths(page.month, 1)}`;
          if (selector.includes("이전달")) return `/page/rent/s01.od.list.php?sch_sym=${addMonths(page.month, -1)}`;
          return null;
        }),
        click: vi.fn(async () => {
          if (selector.includes("다음달")) page.month = addMonths(page.month, 1);
          if (selector.includes("이전달")) page.month = addMonths(page.month, -1);
        })
      })
    }))
  };
  return page;
}

function addMonths(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + monthNumber - 1 + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

vi.mock("../src/browserSession.js", () => ({
  openGangdongSession,
  ensureLoggedIn: vi.fn(async () => true),
  looksLikeProtectionOrLogin
}));

vi.mock("../src/parser.js", () => ({
  parseReservationDom
}));

vi.mock("../src/providers/hanamProvider.js", () => ({
  checkHanamVenues,
  hanamVenueIdsFromWatches: (watches = []) => Array.from(new Set(
    watches.flatMap((watch) => watch.venues || []).filter((venueId) => String(venueId).startsWith("hanam-") || String(venueId).startsWith("misa-"))
  ))
}));

const { checkAllVenues, checkGangdongVenues, checkVenue, groupDatesByMonth, runProviderCheck } = await import("../src/checker.js");

beforeEach(() => {
  openGangdongSession.mockReset();
  looksLikeProtectionOrLogin.mockReset();
  looksLikeProtectionOrLogin.mockResolvedValue(false);
  checkHanamVenues.mockReset();
  checkHanamVenues.mockResolvedValue({});
  parseReservationDom.mockReset();
  parseReservationDom.mockImplementation(async () => [
    {
      venue: "gangil",
      venueName: "강일테니스장",
      date: "2026-08-29",
      time: "18:00~20:00",
      available: false,
      availableCount: 0
    },
    {
      venue: "gangil",
      venueName: "강일테니스장",
      date: "2026-08-30",
      time: "18:00~20:00",
      available: false,
      availableCount: 0
    }
  ]);
});

describe("checkAllVenues targeting", () => {
  it("does not launch Playwright when all providers are inactive", async () => {
    await expect(checkAllVenues({ watches: [], requireWatches: true })).resolves.toEqual({});

    expect(openGangdongSession).not.toHaveBeenCalled();
  });

  it("keeps diagnosis-style full checks available without alert targets", async () => {
    const context = { close: vi.fn() };
    const page = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => {})
    };
    openGangdongSession.mockResolvedValueOnce({ context, page });

    const result = await checkAllVenues();

    expect(openGangdongSession).toHaveBeenCalledTimes(1);
    expect(Object.keys(result)).toEqual(["gangil", "myeongil"]);
  });

  it("filters each active provider to the requested unique dates", async () => {
    const context = { close: vi.fn() };
    const page = makeCalendarPage();
    openGangdongSession.mockResolvedValueOnce({ context, page });

    const result = await checkAllVenues({
      watches: [{ id: "w1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true }]
    });

    expect(result.gangil).toHaveLength(1);
    expect(result.gangil[0].date).toBe("2026-08-29");
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it("merges Hanam provider results into the checked result", async () => {
    checkHanamVenues.mockResolvedValueOnce({
      "hanam-tennis-1": [
        {
          provider: "hanam",
          venue: "hanam-tennis-1",
          venueName: "하남 제1테니스장",
          date: "2026-09-14",
          time: "06:00~07:00",
          startTime: "06:00",
          endTime: "07:00",
          available: false
        }
      ],
      "misa-all": []
    });

    const result = await checkAllVenues({
      watches: [
        { id: "h1", venues: ["hanam-tennis-1"], date: "2026-09-14", times: ["06:00~07:00"], enabled: true },
        { id: "m1", venues: ["misa-all"], date: "2026-09-14", times: ["06:00~08:00"], enabled: true }
      ]
    });

    expect(result["hanam-tennis-1"]).toHaveLength(1);
    expect(result["misa-all"]).toEqual([]);
    expect(checkHanamVenues).toHaveBeenCalledWith(["hanam-tennis-1", "misa-all"], {
      venueDates: {
        "hanam-tennis-1": ["2026-09-14"],
        "misa-all": ["2026-09-14"]
      },
      watches: expect.any(Array)
    });
  });

  it("classifies a missing target date cell as a calendar date error instead of zero vacancies", async () => {
    const context = { close: vi.fn() };
    const page = makeCalendarPage("2026-08", { missingDates: ["2026-08-27"] });
    openGangdongSession.mockResolvedValueOnce({ context, page });
    parseReservationDom.mockResolvedValueOnce([
      {
        venue: "gangil",
        venueName: "강일테니스장",
        date: "2026-08-28",
        time: "06:00~08:00",
        available: false,
        availableCount: 0
      }
    ]);

    const result = await checkAllVenues({
      watches: [{ id: "w1", venues: ["gangil"], date: "2026-08-27", times: ["06:00~08:00"], enabled: true }]
    });

    expect(result.gangil).toBeUndefined();
    expect(result[Symbol.for("tennis.checkMeta")].errors[0].message).toContain("CALENDAR_DATE_NOT_FOUND");
  });

  it("classifies login or protection pages without retrying them", async () => {
    const context = { close: vi.fn() };
    const page = makeCalendarPage();
    openGangdongSession.mockResolvedValueOnce({ context, page });
    looksLikeProtectionOrLogin.mockResolvedValueOnce(true);

    const result = await checkGangdongVenues(["gangil"], {
      venueDates: { gangil: ["2026-08-29"] },
      retryDelayMs: 0
    });

    expect(result.gangil).toBeUndefined();
    expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({
      provider: "gangdong",
      venueId: "gangil",
      type: "LOGIN_OR_PROTECTION_PAGE",
      retryable: false
    });
    expect(openGangdongSession).toHaveBeenCalledTimes(1);
  });

  it("deduplicates live venue checks across users", async () => {
    const context = { close: vi.fn() };
    const page = makeCalendarPage();
    openGangdongSession.mockResolvedValueOnce({ context, page });

    await checkAllVenues({
      watches: [
        { id: "a", userId: "u1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true },
        { id: "b", userId: "u2", venues: ["gangil"], date: "2026-08-29", times: ["10:00~12:00"], enabled: true }
      ]
    });

    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate provider checks while one is already running", async () => {
    let release;
    const running = vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ gangil: [] });
    }));

    const first = runProviderCheck("gangdong", running);
    const second = await runProviderCheck("gangdong", vi.fn(async () => ({ gangil: [] })));
    release();

    await expect(first).resolves.toEqual({ gangil: [] });
    expect(second).toEqual({});
    expect(running).toHaveBeenCalledTimes(1);
  });

  it("releases the provider lock after a provider hard timeout", async () => {
    await expect(runProviderCheck("gangdong", () => new Promise(() => {}), { timeoutMs: 5 })).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT"
    });

    await expect(runProviderCheck("gangdong", async () => ({ gangil: [] }), { timeoutMs: 100 })).resolves.toEqual({ gangil: [] });
  });

  it("retries a retryable venue failure once and keeps the successful retry", async () => {
    const firstContext = { close: vi.fn() };
    const secondContext = { close: vi.fn() };
    const firstPage = makeCalendarPage("2026-08");
    const secondPage = makeCalendarPage("2026-08");
    firstPage.goto.mockRejectedValueOnce(new Error("page.goto timeout after 30000ms"));
    openGangdongSession
      .mockResolvedValueOnce({ context: firstContext, page: firstPage })
      .mockResolvedValueOnce({ context: secondContext, page: secondPage });
    parseReservationDom.mockResolvedValueOnce([
      { venue: "gangil", venueName: "강일테니스장", date: "2026-08-29", time: "18:00~20:00", available: false, availableCount: 0 }
    ]);

    const result = await checkGangdongVenues(["gangil"], {
      venueDates: { gangil: ["2026-08-29"] },
      retryDelayMs: 0
    });

    expect(result.gangil).toHaveLength(1);
    expect(result[Symbol.for("tennis.checkMeta")].errors).toEqual([]);
    expect(openGangdongSession).toHaveBeenCalledTimes(2);
  });

  it("keeps the diagnostic error when retry also fails", async () => {
    const firstContext = { close: vi.fn() };
    const secondContext = { close: vi.fn() };
    const firstPage = makeCalendarPage("2026-08");
    const secondPage = makeCalendarPage("2026-08");
    firstPage.goto.mockRejectedValueOnce(new Error("page.goto timeout after 30000ms"));
    secondPage.goto.mockRejectedValueOnce(new Error("page.goto timeout after 30000ms"));
    openGangdongSession
      .mockResolvedValueOnce({ context: firstContext, page: firstPage })
      .mockResolvedValueOnce({ context: secondContext, page: secondPage });

    const result = await checkGangdongVenues(["gangil"], {
      venueDates: { gangil: ["2026-08-29"] },
      retryDelayMs: 0
    });

    expect(result.gangil).toBeUndefined();
    expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({
      provider: "gangdong",
      venueId: "gangil",
      type: "TIMEOUT"
    });
    expect(openGangdongSession).toHaveBeenCalledTimes(2);
  });
});

describe("Gangdong calendar month navigation", () => {
  it("returns available slots when the target date cell and available slot exist", async () => {
    const page = makeCalendarPage("2026-08");
    parseReservationDom.mockResolvedValueOnce([
      { venue: "gangil", venueName: "강일테니스장", date: "2026-08-29", time: "18:00~20:00", available: true, availableCount: 1 }
    ]);

    const result = await checkVenue(page, "gangil", { dates: ["2026-08-29"] });

    expect(result).toHaveLength(1);
    expect(result[0].available).toBe(true);
  });

  it("returns unavailable slots when the target date cell and reserved slot exist", async () => {
    const page = makeCalendarPage("2026-08");
    parseReservationDom.mockResolvedValueOnce([
      { venue: "gangil", venueName: "강일테니스장", date: "2026-08-29", time: "18:00~20:00", available: false, availableCount: 0 }
    ]);

    const result = await checkVenue(page, "gangil", { dates: ["2026-08-29"] });

    expect(result).toHaveLength(1);
    expect(result[0].available).toBe(false);
  });

  it("treats a target date cell with zero slot elements as NO_SLOT_DATA and not an error", async () => {
    const page = makeCalendarPage("2026-09", { slotCounts: { "2026-09-12": 0 } });
    parseReservationDom.mockResolvedValueOnce([]);

    await expect(checkVenue(page, "gangil", { dates: ["2026-09-12"] })).resolves.toEqual([]);
  });

  it("does not throw TARGET_DATE_NOT_PARSED when the target date cell exists but parser returns no items for it", async () => {
    const page = makeCalendarPage("2026-09");
    parseReservationDom.mockResolvedValueOnce([
      { venue: "gangil", venueName: "강일테니스장", date: "2026-09-13", time: "18:00~20:00", available: false, availableCount: 0 }
    ]);

    await expect(checkVenue(page, "gangil", { dates: ["2026-09-12"] })).resolves.toEqual([]);
  });

  it("throws CALENDAR_DATE_NOT_FOUND only when the target date cell itself is missing", async () => {
    const page = makeCalendarPage("2026-09", { missingDates: ["2026-09-12"] });
    parseReservationDom.mockResolvedValueOnce([]);

    await expect(checkVenue(page, "gangil", { dates: ["2026-09-12"] })).rejects.toThrow("CALENDAR_DATE_NOT_FOUND");
  });

  it("checks the current month without moving", async () => {
    const page = makeCalendarPage("2026-08");
    parseReservationDom.mockImplementationOnce(async (currentPage) => [
      { venue: "gangil", venueName: "강일테니스장", date: `${currentPage.month}-29`, time: "18:00~20:00", available: true, availableCount: 1 }
    ]);

    const result = await checkVenue(page, "gangil", { dates: ["2026-08-29"] });

    expect(result).toHaveLength(1);
    expect(page.month).toBe("2026-08");
  });

  it("moves once for the next month", async () => {
    const page = makeCalendarPage("2026-08");
    parseReservationDom.mockImplementationOnce(async (currentPage) => [
      { venue: "gangil", venueName: "강일테니스장", date: `${currentPage.month}-12`, time: "06:00~08:00", available: true, availableCount: 1 }
    ]);

    const result = await checkVenue(page, "gangil", { dates: ["2026-09-12"] });

    expect(result[0].date).toBe("2026-09-12");
    expect(page.month).toBe("2026-09");
  });

  it("moves twice for a date two months ahead", async () => {
    const page = makeCalendarPage("2026-08");
    parseReservationDom.mockImplementationOnce(async (currentPage) => [
      { venue: "gangil", venueName: "강일테니스장", date: `${currentPage.month}-12`, time: "06:00~08:00", available: true, availableCount: 1 }
    ]);

    const result = await checkVenue(page, "gangil", { dates: ["2026-10-12"] });

    expect(result[0].date).toBe("2026-10-12");
    expect(page.month).toBe("2026-10");
  });

  it("moves from December to next January", async () => {
    const page = makeCalendarPage("2026-12");
    parseReservationDom.mockImplementationOnce(async (currentPage) => [
      { venue: "gangil", venueName: "강일테니스장", date: `${currentPage.month}-12`, time: "06:00~08:00", available: true, availableCount: 1 }
    ]);

    const result = await checkVenue(page, "gangil", { dates: ["2027-01-12"] });

    expect(result[0].date).toBe("2027-01-12");
    expect(page.month).toBe("2027-01");
  });

  it("groups multiple dates in the same month into one calendar parse", async () => {
    const page = makeCalendarPage("2026-08");
    parseReservationDom.mockImplementationOnce(async (currentPage) => [
      { venue: "gangil", venueName: "강일테니스장", date: `${currentPage.month}-12`, time: "06:00~08:00", available: true, availableCount: 1 },
      { venue: "gangil", venueName: "강일테니스장", date: `${currentPage.month}-13`, time: "08:00~10:00", available: true, availableCount: 1 }
    ]);

    const result = await checkVenue(page, "gangil", { dates: ["2026-09-12", "2026-09-13"] });

    expect(result).toHaveLength(2);
    expect(parseReservationDom).toHaveBeenCalledTimes(1);
  });

  it("groups different watch months and visits each month once", () => {
    expect(groupDatesByMonth(["2026-09-12", "2026-09-13", "2026-10-01"])).toEqual([
      ["2026-09", ["2026-09-12", "2026-09-13"]],
      ["2026-10", ["2026-10-01"]]
    ]);
  });

  it("keeps Gangdong partially successful when one venue is missing the date cell", async () => {
    const context = { close: vi.fn() };
    const page = makeCalendarPage("2026-09", {
      missingDatesByVenue: {
        myeongil: ["2026-09-12"]
      }
    });
    openGangdongSession.mockResolvedValueOnce({ context, page });
    parseReservationDom
      .mockResolvedValueOnce([
        { venue: "gangil", venueName: "강일테니스장", date: "2026-09-12", time: "06:00~08:00", available: false, availableCount: 0 }
      ])
      .mockResolvedValueOnce([]);

    const result = await checkAllVenues({
      watches: [
        { id: "g", venues: ["gangil"], date: "2026-09-12", times: ["06:00~08:00"], enabled: true },
        { id: "m", venues: ["myeongil"], date: "2026-09-12", times: ["06:00~08:00"], enabled: true }
      ]
    });

    expect(result.gangil).toHaveLength(1);
    expect(result.myeongil).toBeUndefined();
    expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({
      provider: "gangdong",
      venueId: "myeongil"
    });
  });
});
