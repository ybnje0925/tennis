import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let dir;
const originalDataDir = process.env.DATA_DIR;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T15:00:00Z")); // KST Oct 9 midnight.
  dir = await mkdtemp(path.join(os.tmpdir(), "tennis-watch-expiry-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
});
afterEach(async () => {
  vi.useRealTimers();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  vi.resetModules();
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("tennis-watch-expiry-")) throw Error("Unsafe test cleanup");
  await rm(resolved, { recursive: true, force: true });
});
async function seed(watches) {
  await writeFile(path.join(dir, "state.json"), JSON.stringify({ watches, users: [], lastAvailability: { preserved: true }, sentNotifications: {} }));
}
const watch = (id, date, userId = "u1", enabled = true) => ({ id, date, userId, enabled, venues: ["songpa-oryun"], times: ["18:00~20:00"] });

describe("persisted watch expiration", () => {
  it("disables all users' past dates while keeping today and future conditions", async () => {
    await seed([watch("old-a", "2026-09-23"), watch("old-b", "2026-10-08", "u2"), watch("today", "2026-10-09"), watch("future", "2026-10-14"), watch("off", "2026-09-25", "u3", false)]);
    const { loadState } = await import("../src/storage.js");
    const result = await loadState();
    expect(result.watches.map(w => w.enabled)).toEqual([false, false, true, true, false]);
    expect(result.watches[0]).toMatchObject({ autoDisabledReason: "DATE_PASSED", autoDisabledAt: "2026-10-08T15:00:00.000Z" });
    expect(result.watches[4].autoDisabledAt).toBeUndefined();
    const saved = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    expect(saved.watches).toEqual(result.watches);
    expect(saved.lastAvailability).toEqual({ preserved: true });
    vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
    expect((await loadState()).watches[0].autoDisabledAt).toBe("2026-10-08T15:00:00.000Z");
  });
  it("keeps a condition enabled until the date ends in Korea", async () => {
    await seed([watch("ending", "2026-10-08")]);
    vi.setSystemTime(new Date("2026-10-08T14:59:59Z"));
    const { loadState } = await import("../src/storage.js");
    expect((await loadState()).watches[0].enabled).toBe(true);
    vi.setSystemTime(new Date("2026-10-08T15:00:00Z"));
    expect((await loadState()).watches[0].enabled).toBe(false);
  });
  it("prevents re-enabling an expired condition", async () => {
    await seed([watch("old", "2026-09-23")]);
    const { updateWatch, loadState } = await import("../src/storage.js");
    expect((await updateWatch("old", { enabled: true }, "u1")).enabled).toBe(false);
    expect((await loadState()).watches[0].enabled).toBe(false);
  });
  it("serializes expiration with concurrent edits without losing a future watch", async () => {
    await seed([watch("old", "2026-09-23")]);
    const { loadState, updateState } = await import("../src/storage.js");
    await Promise.all([loadState(), updateState(state => { state.watches.push(watch("new", "2026-10-14", "u2")); }), loadState()]);
    expect((await loadState()).watches.map(w => [w.id, w.enabled])).toEqual([["old", false], ["new", true]]);
  });
});
