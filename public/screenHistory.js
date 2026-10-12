const screens = new Set(["home", "results", "new", "status", "settings", "catalog"]);

export function createScreenHistory(browser, render) {
  let current;
  const home = { screen: "home", step: 1 };
  const read = state => state?.tennisNavigation === 1 && screens.has(state.screen)
    ? { screen: state.screen, step: state.screen === "new" && state.step === 2 ? 2 : 1 }
    : null;
  const write = (method, route) => browser.history[method]({
    ...browser.history.state, tennisNavigation: 1, ...route, boundary: false
  }, "");

  browser.addEventListener("popstate", event => {
    if (!current) return;
    current = read(event.state) || home;
    // Keep one home entry above the boundary so Back stays inside the app.
    if (event.state?.boundary || !read(event.state)) write("pushState", current);
    render(current);
  });

  return {
    start() {
      if (!current) {
        current = read(browser.history.state) || home;
        if (!read(browser.history.state) || browser.history.state.boundary) {
          browser.history.replaceState({ tennisNavigation: 1, ...home, boundary: true }, "");
          write("pushState", current);
        }
      }
      render(current);
    },
    go(screen, step = 1) {
      if (!screens.has(screen)) return;
      const next = { screen, step: screen === "new" && step === 2 ? 2 : 1 };
      if (!current) this.start();
      if (current.screen === next.screen && current.step === next.step) return;
      write("pushState", next);
      current = next;
      render(current);
    },
    back() { browser.history.back(); }
  };
}
