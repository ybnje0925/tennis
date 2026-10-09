import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, config: { ...actual.config, songpaHttpEnabled: true,
    legacyHttpFallback: false, songpaUserId: "test-user", songpaUserPassword: "test-password" },
    assertSongpaLoginConfig: vi.fn() };
});
vi.mock("../src/playwrightLauncher.js", () => ({ launchPersistentContext: vi.fn() }));
const { checkSongpaVenues } = await import("../src/providers/songpaProvider.js");
const { launchPersistentContext } = await import("../src/playwrightLauncher.js");
const ids = ["oryun", "seongnaecheon", "songpa", "ogeum"];
const html = Object.fromEntries(ids.map(id => [id, readFileSync(new URL(`./fixtures/songpa-${id}-october.html`, import.meta.url), "utf8")]));
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValueOnce(new Response("login", { headers: { "set-cookie": "session=test; Path=/" } }))
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/", "set-cookie": "auth=yes; Path=/" } }));
  vi.stubGlobal("fetch", fetchMock);
  launchPersistentContext.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("Songpa HTTP monitoring", () => {
  it("reads all four authenticated calendars without launching a browser", async () => {
    for (const id of ids) fetchMock.mockResolvedValueOnce(new Response(html[id]));
    const venueIds = ids.map(id => `songpa-${id}`);
    const result = await checkSongpaVenues(venueIds, { venueDates: Object.fromEntries(venueIds.map(id => [id, ["2026-10-04"]])) });
    expect(Object.keys(result)).toEqual(venueIds);
    for (const id of venueIds) {
      expect(result[id].length).toBeGreaterThan(0);
      expect(result[id].every(item => item.date === "2026-10-04")).toBe(true);
    }
    expect(launchPersistentContext).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[2][1].headers.get("cookie")).toContain("auth=yes");
    for (const [, init] of fetchMock.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it("accepts a real calendar containing a login guidance sentence", async () => {
    fetchMock.mockResolvedValueOnce(new Response(html.oryun + "로그인 후 이용"));
    const result = await checkSongpaVenues(["songpa-oryun"]);
    expect(result["songpa-oryun"].length).toBeGreaterThan(0);
  });
  it("does not treat an expired login as an empty successful calendar", async () => {
    fetchMock.mockResolvedValueOnce(new Response('<form id="flogin"><input type="password"></form>'));
    const result = await checkSongpaVenues(["songpa-oryun"]);
    expect(result["songpa-oryun"]).toBeUndefined();
    expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({ type: "LOGIN_OR_PROTECTION_PAGE" });
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });
  it("rejects a calendar for the wrong month", async () => {
    fetchMock.mockResolvedValueOnce(new Response(html.oryun));
    const result = await checkSongpaVenues(["songpa-oryun"], { venueDates: { "songpa-oryun": ["2026-11-04"] } });
    expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({ type: "CALENDAR_DATE_NOT_FOUND" });
  });
  it("does not authenticate when no Songpa venues are requested", async () => {
    expect(await checkSongpaVenues([])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


it("keeps another venue successful when one calendar is malformed", async () => {
  fetchMock.mockResolvedValueOnce(new Response("<div>unexpected calendar</div>"))
    .mockResolvedValueOnce(new Response(html.ogeum));
  const result = await checkSongpaVenues(["songpa-oryun", "songpa-ogeum"]);
  expect(result["songpa-oryun"]).toBeUndefined();
  expect(result["songpa-ogeum"].length).toBeGreaterThan(0);
  expect(result[Symbol.for("tennis.checkMeta")].errors).toHaveLength(1);
  expect(result[Symbol.for("tennis.checkMeta")].errors[0]).toMatchObject({ venueId: "songpa-oryun", type: "PARSE_FAILED" });
  expect(launchPersistentContext).not.toHaveBeenCalled();
});
