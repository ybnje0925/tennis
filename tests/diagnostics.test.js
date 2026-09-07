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
      retryable: true
    });
  });
});
