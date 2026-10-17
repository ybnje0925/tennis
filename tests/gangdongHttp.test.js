import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", async (original) => {
  const actual = await original();
  return { ...actual, config: { ...actual.config, legacyHttpEnabled: true, legacyHttpFallback: true,
    gangdongUserId: "mock-user", gangdongUserPassword: "mock-password" } };
});
vi.mock("../src/playwrightLauncher.js", () => ({ launchPersistentContext: vi.fn() }));

const calendar = '<div class="calendar1_yearmonth"><strong>2026.10</strong></div>'
  + '<table class="calendar1_table"><tr><td>18<ul><li>18:00~20:00 예약가능(1)</li></ul></td></tr></table>';
const loginPage = '<form action="/bbs/login_check.php"><input name="mb_password" type="password"></form>';
const options = { venueDates: { gangil: ["2026-10-18", "2026-10-19"], myeongil: ["2026-10-18"] } };
let fetchMock, checkGangdongVenues, GangdongHttpSession, launchPersistentContext;
function loginResponses(mock = fetchMock) {
  mock.mockResolvedValueOnce(new Response("login", { headers: { "set-cookie": "sid=initial; Path=/" } }))
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/", "set-cookie": "sid=authenticated; Path=/" } }));
}
beforeEach(async () => {
  vi.resetModules();
  fetchMock = vi.fn(async () => { throw new Error("Unexpected mocked request"); });
  vi.stubGlobal("fetch", fetchMock);
  ({ checkGangdongVenues } = await import("../src/checker.js"));
  ({ GangdongHttpSession } = await import("../src/gangdongHttpSession.js"));
  ({ launchPersistentContext } = await import("../src/playwrightLauncher.js"));
  launchPersistentContext.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("Gangdong reusable HTTP monitoring (no live requests)", () => {
  it("logs in once across cycles and deduplicates facilities and months", async () => {
    loginResponses();
    for (let i = 0; i < 4; i++) fetchMock.mockResolvedValueOnce(new Response(calendar + "로그인 후 이용"));
    for (let cycle = 0; cycle < 2; cycle++) {
      const result = await checkGangdongVenues(["gangil", "gangil", "myeongil"], options);
      expect(result.gangil).toHaveLength(1);
      expect(result.myeongil).toHaveLength(1);
      expect(result[Symbol.for("tennis.checkMeta")].errors).toEqual([]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls[1][1].headers.get("cookie")).toBe("sid=initial");
    for (const [, init] of fetchMock.mock.calls.slice(2)) expect(init.headers.get("cookie")).toBe("sid=authenticated");
    for (const [, init] of fetchMock.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });

  it("reauthenticates once on expiry and retries only the failed calendar", async () => {
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(calendar));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/bbs/login.php?url=x" } }));
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(calendar));
    const result = await checkGangdongVenues(["gangil", "myeongil"], options);
    expect(result.gangil).toHaveLength(1);
    expect(result.myeongil).toHaveLength(1);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.filter(url => url.includes("s01.od"))).toHaveLength(1);
    expect(urls.filter(url => url.includes("s02.od"))).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(2);
  });

  it("does not relogin or launch a browser for parsing, network or blocking failures", async () => {
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response("unexpected structure"))
      .mockResolvedValueOnce(new Response(calendar));
    const result = await checkGangdongVenues(["gangil", "myeongil"], options);
    expect(result.gangil).toBeUndefined();
    expect(result.myeongil).toHaveLength(1);
    expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({ venueId: "gangil", type: "PARSE_FAILED" });
    fetchMock.mockResolvedValueOnce(new Response(loginPage, { status: 403 }));
    await checkGangdongVenues(["gangil"], options);
    fetchMock.mockResolvedValueOnce(new Response('<script>WG_StartWebGate()</script>' + loginPage));
    await checkGangdongVenues(["gangil"], options);
    fetchMock.mockRejectedValueOnce(new Error("private network details"));
    const failed = await checkGangdongVenues(["gangil"], options);
    expect(failed[Symbol.for("tennis.checkMeta")].errors[0].type).toBe("NETWORK_ERROR");
    expect(JSON.stringify(failed[Symbol.for("tennis.checkMeta")])).not.toContain("private network details");
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });

  it("stops further authentication in the cycle when login remains invalid", async () => {
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(loginPage));
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(loginPage));
    const result = await checkGangdongVenues(["gangil", "myeongil"], options);
    expect(result[Symbol.for("tennis.checkMeta")].errors).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });

  it("shares one login across concurrent requests", async () => {
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(calendar)).mockResolvedValueOnce(new Response(calendar));
    const session = new GangdongHttpSession({ fetchImpl: fetchMock });
    await Promise.all([session.calendar("https://gdgd.igangdong.or.kr/page/rent/s01.od.list.php"),
      session.calendar("https://gdgd.igangdong.or.kr/page/rent/s02.od.list.php")]);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  });

  it("shares one reauthentication across concurrent expired calendars", async () => {
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(calendar));
    const session = new GangdongHttpSession({ fetchImpl: fetchMock });
    const url = "https://gdgd.igangdong.or.kr/page/rent/s01.od.list.php";
    await session.calendar(url);
    fetchMock.mockResolvedValueOnce(new Response(loginPage)).mockResolvedValueOnce(new Response(loginPage));
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(calendar)).mockResolvedValueOnce(new Response(calendar));
    await Promise.all([session.calendar(url), session.calendar(url)]);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(2);
  });

  it("preserves another month's result when a calendar fails", async () => {
    loginResponses();
    fetchMock.mockResolvedValueOnce(new Response(calendar)).mockResolvedValueOnce(new Response("invalid calendar"));
    const result = await checkGangdongVenues(["gangil"], { venueDates: { gangil: ["2026-10-18", "2026-11-18"] } });
    expect(result.gangil).toHaveLength(1);
    expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({ targetDate: "2026-11-18", type: "PARSE_FAILED" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("makes no requests without Gangdong targets", async () => {
    expect(await checkGangdongVenues([])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
