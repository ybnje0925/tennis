import { describe, expect, it } from "vitest";
import { classifyError } from "../src/diagnostics.js";

describe("classifyError", () => {
  it("classifies Chromium EAGAIN spawn failures as browser launch failures", () => {
    const diagnostic = classifyError(new Error(
      "browserType.launchPersistentContext: Failed to launch: Error: spawn /ms-playwright/chromium_headless_shell/chrome-headless-shell EAGAIN"
    ), { provider: "songpa", stage: "BROWSER" });

    expect(diagnostic).toMatchObject({
      provider: "songpa",
      stage: "BROWSER",
      type: "BROWSER_LAUNCH_FAILED",
      userCategory: "브라우저 시작 문제",
      userMessage: "서버 자원이 잠시 부족해서 예약 사이트를 확인할 브라우저를 새로 열지 못했습니다.",
      retryable: true
    });
  });

  it("describes closed headless browser crashes without exposing launch logs", () => {
    const diagnostic = classifyError(new Error(
      "browserType.launchPersistentContext: Target page, context or browser has been closed Browser logs: <launching> chrome-headless-shell --disable-background-networking <launched> pid=49550 process did exit: signal=SIGTRAP"
    ));

    expect(diagnostic).toMatchObject({
      type: "BROWSER_LAUNCH_FAILED",
      userCategory: "브라우저 시작 문제",
      userMessage: "예약 사이트를 확인하려고 브라우저를 켰지만, 시작 직후 브라우저가 종료됐습니다."
    });
    expect(diagnostic.userMessage).not.toContain("chrome-headless-shell");
  });
});
