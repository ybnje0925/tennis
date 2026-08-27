import { afterEach, describe, expect, it } from "vitest";
import { buildInfo } from "../src/buildInfo.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("buildInfo", () => {
  it("exposes Railway commit metadata and KST server time", () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "abcdef1234567890";
    process.env.RAILWAY_GIT_BRANCH = "main";

    const info = buildInfo(new Date("2026-08-27T13:07:00.000Z"));

    expect(info.buildCommit).toBe("abcdef1234567890");
    expect(info.buildBranch).toBe("main");
    expect(info.serverTime).toBe("2026-08-27T13:07:00.000Z");
    expect(info.serverTimeKst).toBe("2026-08-27T22:07:00+09:00");
    expect(info.startedAt).toBeTruthy();
  });
});
