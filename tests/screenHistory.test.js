import { describe, expect, it, vi } from "vitest";
import { createScreenHistory } from "../public/screenHistory.js";

function browserHistory() {
  const entries = [null];
  let index = 0;
  let onPop;
  const browser = {
    addEventListener: (_, callback) => { onPop = callback; },
    history: {
      get state() { return entries[index]; },
      get length() { return entries.length; },
      replaceState(state) { entries[index] = state; },
      pushState(state) { entries.splice(++index, entries.length, state); },
      back() { if (index > 0) { index--; onPop({ state: entries[index] }); } },
      forward() { if (index < entries.length - 1) { index++; onPop({ state: entries[index] }); } }
    }
  };
  return browser;
}

describe("screen navigation history", () => {
  it("returns to previous screens and supports Forward without adding entries", () => {
    const browser = browserHistory();
    const render = vi.fn();
    const navigation = createScreenHistory(browser, render);
    navigation.start();
    navigation.go("status");
    navigation.go("settings");
    const length = browser.history.length;
    browser.history.back();
    expect(render).toHaveBeenLastCalledWith({ screen: "status", step: 1 });
    browser.history.back();
    expect(render).toHaveBeenLastCalledWith({ screen: "home", step: 1 });
    browser.history.forward();
    expect(render).toHaveBeenLastCalledWith({ screen: "status", step: 1 });
    expect(browser.history.length).toBe(length);
  });

  it("returns from schedule selection to venue selection and preserves the step on Forward", () => {
    const browser = browserHistory();
    const render = vi.fn();
    const navigation = createScreenHistory(browser, render);
    navigation.start();
    navigation.go("new");
    navigation.go("new", 2);
    navigation.back();
    expect(render).toHaveBeenLastCalledWith({ screen: "new", step: 1 });
    browser.history.forward();
    expect(render).toHaveBeenLastCalledWith({ screen: "new", step: 2 });
  });

  it("keeps Back at home inside the app, including repeated presses", () => {
    const browser = browserHistory();
    const render = vi.fn();
    createScreenHistory(browser, render).start();
    for (let i = 0; i < 4; i++) {
      browser.history.back();
      expect(browser.history.state.boundary).toBe(false);
      expect(render).toHaveBeenLastCalledWith({ screen: "home", step: 1 });
      expect(browser.history.length).toBe(2);
    }
  });

  it("restores the current screen on reload without duplicating history", () => {
    const browser = browserHistory();
    const navigation = createScreenHistory(browser, vi.fn());
    navigation.start();
    navigation.go("new", 2);
    const length = browser.history.length;
    const render = vi.fn();
    const reloaded = createScreenHistory(browser, render);
    reloaded.start();
    reloaded.start();
    reloaded.go("new", 2);
    reloaded.go("invalid");
    expect(browser.history.length).toBe(length);
    expect(render).toHaveBeenLastCalledWith({ screen: "new", step: 2 });
  });
});
