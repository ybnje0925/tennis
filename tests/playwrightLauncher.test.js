import { beforeEach, describe, expect, it, vi } from "vitest";

const launchPersistentContextMock = vi.fn();

vi.mock("playwright", () => ({
  chromium: { launchPersistentContext: launchPersistentContextMock }
}));

async function importLauncher() {
  vi.resetModules();
  return import("../src/playwrightLauncher.js");
}

describe("launchPersistentContext", () => {
  beforeEach(() => {
    launchPersistentContextMock.mockReset();
  });

  it("serializes browser launches across providers", async () => {
    const { launchPersistentContext } = await importLauncher();
    let releaseFirst;
    const firstContext = { id: "first" };
    const secondContext = { id: "second" };
    launchPersistentContextMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = () => resolve(firstContext);
      }))
      .mockResolvedValueOnce(secondContext);

    const first = launchPersistentContext("/tmp/first", {}, { providerLabel: "강동" });
    const second = launchPersistentContext("/tmp/second", {}, { providerLabel: "송파" });

    await waitForTick();
    expect(launchPersistentContextMock).toHaveBeenCalledTimes(1);

    releaseFirst();
    await expect(first).resolves.toBe(firstContext);
    await expect(second).resolves.toBe(secondContext);
    expect(launchPersistentContextMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient browser spawn failures", async () => {
    const { launchPersistentContext } = await importLauncher();
    const context = { id: "context" };
    launchPersistentContextMock
      .mockRejectedValueOnce(new Error("browserType.launchPersistentContext: Failed to launch: Error: spawn chrome EAGAIN"))
      .mockResolvedValueOnce(context);

    await expect(launchPersistentContext("/tmp/profile", {}, {
      providerLabel: "송파",
      retryDelaysMs: [1]
    })).resolves.toBe(context);

    expect(launchPersistentContextMock).toHaveBeenCalledTimes(2);
  });

  it("passes the timeout to Playwright so it cancels and cleans up failed launches", async () => {
    const { launchPersistentContext } = await importLauncher();
    launchPersistentContextMock.mockRejectedValue(new Error("browserType.launchPersistentContext: Timeout 7ms exceeded"));
    await expect(launchPersistentContext("/tmp/profile", { headless: true, timeout: 0 }, {
      timeoutMs: 7, retryDelaysMs: []
    })).rejects.toThrow("Timeout 7ms");
    expect(launchPersistentContextMock).toHaveBeenCalledWith("/tmp/profile", { headless: true, timeout: 7 });
    launchPersistentContextMock.mockResolvedValue({ id: "next" });
    await expect(launchPersistentContext("/tmp/next", {}, { retryDelaysMs: [] })).resolves.toEqual({ id: "next" });
  });
});

function waitForTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
