import { describe, expect, it, vi } from "vitest";

const openGangdongSession = vi.fn();
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

vi.mock("../src/browserSession.js", () => ({
  openGangdongSession,
  ensureLoggedIn: vi.fn(async () => true),
  looksLikeProtectionOrLogin: vi.fn(async () => false)
}));

vi.mock("../src/parser.js", () => ({
  parseReservationDom
}));

const { checkAllVenues, runProviderCheck } = await import("../src/checker.js");

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
    const page = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => {})
    };
    openGangdongSession.mockResolvedValueOnce({ context, page });

    const result = await checkAllVenues({
      watches: [{ id: "w1", venues: ["gangil"], date: "2026-08-29", times: ["18:00~20:00"], enabled: true }]
    });

    expect(result.gangil).toHaveLength(1);
    expect(result.gangil[0].date).toBe("2026-08-29");
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it("classifies a missing target date as a parser error instead of zero vacancies", async () => {
    const context = { close: vi.fn() };
    const page = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => {})
    };
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
    expect(result[Symbol.for("tennis.checkMeta")].errors[0].message).toContain("TARGET_DATE_NOT_PARSED");
  });

  it("deduplicates live venue checks across users", async () => {
    const context = { close: vi.fn() };
    const page = {
      goto: vi.fn(),
      waitForLoadState: vi.fn(async () => {})
    };
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
});
