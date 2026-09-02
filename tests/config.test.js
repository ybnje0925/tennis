import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

async function loadConfigWith(env) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  for (const key of [
    "CHECK_INTERVAL_MINUTES",
    "GANGDONG_POLLING_MINUTES",
    "SONGPA_POLLING_MINUTES",
    "OLYMPIC_POLLING_MINUTES",
    "HANAM_POLLING_MINUTES"
  ]) {
    if (env[key] === undefined) process.env[key] = "";
  }
  return import("../src/config.js");
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe("provider polling minutes config", () => {
  it("defaults all providers to 5 minutes without env vars", async () => {
    const { config } = await loadConfigWith({});

    expect(config.providerPollingMinutes).toEqual({
      gangdong: 5,
      songpa: 5,
      olympic: 5,
      hanam: 5
    });
  });

  it("allows Gangdong to use its own polling minutes", async () => {
    const { config } = await loadConfigWith({ GANGDONG_POLLING_MINUTES: "3" });

    expect(config.providerPollingMinutes.gangdong).toBe(3);
    expect(config.providerPollingMinutes.songpa).toBe(5);
    expect(config.providerPollingMinutes.olympic).toBe(5);
    expect(config.providerPollingMinutes.hanam).toBe(5);
  });

  it("allows Songpa to use its own polling minutes", async () => {
    const { config } = await loadConfigWith({ SONGPA_POLLING_MINUTES: "7" });

    expect(config.providerPollingMinutes.songpa).toBe(7);
  });

  it("allows Olympic to use its own polling minutes", async () => {
    const { config } = await loadConfigWith({ OLYMPIC_POLLING_MINUTES: "10" });

    expect(config.providerPollingMinutes.olympic).toBe(10);
  });

  it("allows Hanam to use its own polling minutes", async () => {
    const { config } = await loadConfigWith({ HANAM_POLLING_MINUTES: "6" });

    expect(config.providerPollingMinutes.hanam).toBe(6);
  });

  it("falls back to 5 for zero and non-numeric values", async () => {
    const { config } = await loadConfigWith({
      GANGDONG_POLLING_MINUTES: "0",
      SONGPA_POLLING_MINUTES: "abc"
    });

    expect(config.providerPollingMinutes.gangdong).toBe(5);
    expect(config.providerPollingMinutes.songpa).toBe(5);
  });

  it("keeps CHECK_INTERVAL_MINUTES from changing provider polling minutes", async () => {
    const { config } = await loadConfigWith({
      CHECK_INTERVAL_MINUTES: "8",
      OLYMPIC_POLLING_MINUTES: "10"
    });

    expect(config.checkIntervalMinutes).toBe(8);
    expect(config.providerPollingMinutes.gangdong).toBe(5);
    expect(config.providerPollingMinutes.songpa).toBe(5);
    expect(config.providerPollingMinutes.olympic).toBe(10);
  });

  it("prefers provider-specific 5 minute env vars over CHECK_INTERVAL_MINUTES=10", async () => {
    const { config } = await loadConfigWith({
      CHECK_INTERVAL_MINUTES: "10",
      GANGDONG_POLLING_MINUTES: "5",
      SONGPA_POLLING_MINUTES: "5",
      OLYMPIC_POLLING_MINUTES: "5"
    });

    expect(config.checkIntervalMinutes).toBe(10);
    expect(config.providerPollingMinutes).toEqual({
      gangdong: 5,
      songpa: 5,
      olympic: 5,
      hanam: 5
    });
  });
});
