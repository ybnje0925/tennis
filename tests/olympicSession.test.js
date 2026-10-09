import { beforeEach, describe, expect, it, vi } from "vitest";

const launchPersistentContext = vi.fn();

vi.mock("playwright", () => ({
  chromium: { launchPersistentContext }
}));

function createPage(options = {}) {
  let dialogHandler = null;
  let currentUrl = options.url || "https://www.ksponco.or.kr/online/tennis/index.do";
  const bodyTexts = [...(options.bodyTexts || ["로그아웃 마이페이지 신청내역"])];
  const fill = vi.fn();
  const accept = vi.fn(async () => {});
  const dismiss = vi.fn(async () => {});
  const click = vi.fn(async () => {
    if (options.dialogMessage && dialogHandler) {
      await dialogHandler({
        message: () => options.dialogMessage,
        accept,
        dismiss
      });
    }
    currentUrl = options.reservationRedirect || options.afterClickUrl || "https://www.ksponco.or.kr/online/tennis/resrvtn_aplictn.do";
  });

  return {
    fill,
    accept,
    dismiss,
    page: {
      isClosed: () => false,
      setDefaultTimeout: vi.fn(),
      goto: vi.fn(async (url) => {
        currentUrl = options.reservationRedirect && url.endsWith("/resrvtn_aplictn.do") ? options.reservationRedirect : url;
      }),
      waitForLoadState: vi.fn(async () => {}),
      waitForFunction: vi.fn(async () => {}),
      waitForNavigation: vi.fn(async () => {}),
      url: () => currentUrl,
      once: vi.fn((event, handler) => {
        if (event === "dialog") dialogHandler = handler;
      }),
      locator: vi.fn((selector) => {
        const locator = {
          innerText: vi.fn(async () => (bodyTexts.length > 1 ? bodyTexts.shift() : bodyTexts[0])),
          fill,
          click,
          waitFor: vi.fn(async () => {}),
          filter: () => locator,
          first: () => locator
        };
        return locator;
      })
    }
  };
}

async function importProvider() {
  vi.resetModules();
  process.env.OLYMPIC_USER_ID = "user";
  process.env.OLYMPIC_USER_PASSWORD = "password";
  return import("../src/providers/olympicProvider.js");
}

describe("Olympic session reuse and login locking", () => {
  beforeEach(() => {
    launchPersistentContext.mockReset();
  });

  it("reuses an existing logged-in session without a new login", async () => {
    const { ensureOlympicLoggedIn } = await importProvider();
    const fake = createPage({ bodyTexts: ["로그아웃 마이페이지 신청내역"] });

    await expect(ensureOlympicLoggedIn(fake.page)).resolves.toBe(true);

    expect(fake.fill).not.toHaveBeenCalled();
  });

  it("logs in once when the restored session is expired", async () => {
    const { ensureOlympicLoggedIn } = await importProvider();
    const fake = createPage({
      bodyTexts: [
        "통합회원 ID로그인 아이디 비밀번호",
        "로그아웃 마이페이지 신청내역",
        "로그아웃 마이페이지 신청내역"
      ]
    });

    await expect(ensureOlympicLoggedIn(fake.page)).resolves.toBe(true);

    expect(fake.fill).toHaveBeenCalledTimes(2);
  });

  it("runs only one login when scheduler and manual checks overlap", async () => {
    const { ensureOlympicLoggedIn } = await importProvider();
    const fake = createPage({
      bodyTexts: [
        "통합회원 ID로그인 아이디 비밀번호",
        "로그아웃 마이페이지 신청내역",
        "로그아웃 마이페이지 신청내역"
      ]
    });

    await Promise.all([
      ensureOlympicLoggedIn(fake.page),
      ensureOlympicLoggedIn(fake.page)
    ]);

    expect(fake.fill).toHaveBeenCalledTimes(2);
  });

  it("keeps one Olympic context per process", async () => {
    const { openOlympicSession } = await importProvider();
    const fake = createPage();
    const context = { pages: () => [fake.page], route: vi.fn(async () => {}), close: vi.fn() };
    launchPersistentContext.mockResolvedValue(context);

    const first = await openOlympicSession();
    const second = await openOlympicSession();

    expect(first.context).toBe(second.context);
    expect(launchPersistentContext).toHaveBeenCalledTimes(1);
  });

  it("detects duplicate-session screens and never accepts takeover", async () => {
    const { ensureOlympicLoggedIn, OlympicDuplicateSessionError } = await importProvider();
    const fake = createPage({
      bodyTexts: ["통합회원 ID로그인 아이디 비밀번호", "현재 IP에서 접속중인 계정입니다. 이전 접속을 종료하고 계속 진행하시겠습니까?"],
      dialogMessage: "현재 IP에서 접속중인 계정입니다. 이전 접속을 종료하고 계속 진행하시겠습니까?",
      afterClickUrl: "https://www.ksponco.or.kr/sso/usr/login/view"
    });

    await expect(ensureOlympicLoggedIn(fake.page)).rejects.toBeInstanceOf(OlympicDuplicateSessionError);
    expect(fake.accept).not.toHaveBeenCalled();
    expect(fake.dismiss).toHaveBeenCalledTimes(1);
  });

  it("restores the persistent session after context close", async () => {
    const { openOlympicSession } = await importProvider();
    const fake1 = createPage();
    const context1 = { pages: () => [fake1.page], route: vi.fn(async () => {}), close: vi.fn() };
    const fake2 = createPage();
    const context2 = { pages: () => [fake2.page], route: vi.fn(async () => {}), close: vi.fn() };
    launchPersistentContext.mockResolvedValueOnce(context1).mockResolvedValueOnce(context2);

    const first = await openOlympicSession();
    await first.context.close();
    const second = await openOlympicSession();

    expect(first.context).not.toBe(second.context);
    expect(second.sessionSource).toBe("restored");
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it("logs browser lifecycle events while keeping the persistent profile", async () => {
    const { openOlympicSession } = await importProvider();
    const fake = createPage();
    const context = { pages: () => [fake.page], route: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    launchPersistentContext.mockResolvedValue(context);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const session = await openOlympicSession();
    await session.context.close();

    expect(info.mock.calls.some(([message]) => message.includes("browser started"))).toBe(true);
    expect(info.mock.calls.some(([message]) => message.includes("browser closed"))).toBe(true);
    expect(launchPersistentContext).toHaveBeenCalledWith(expect.stringContaining("olympic-profile"), expect.any(Object));
    info.mockRestore();
  });
});


describe("Olympic login regression", () => {
  it("does not trust public member-navigation menus as an authenticated session", async () => {
    const { isOlympicLoggedIn } = await importProvider();
    const fake = createPage({ bodyTexts: ["로그인 마이페이지 신청내역 예약신청"] });
    expect(await isOlympicLoggedIn(fake.page)).toBe(false);
  });
  it("uses the actual tennis login form and leaves a verified reservation page open", async () => {
    const { ensureOlympicLoggedIn, OLYMPIC_LOGIN_SELECTORS } = await importProvider();
    const fake = createPage({ bodyTexts: ["로그인 마이페이지 신청내역", "로그아웃 마이페이지", "로그아웃 마이페이지"] });
    expect(await ensureOlympicLoggedIn(fake.page)).toBe(true);
    expect(fake.page.goto.mock.calls.some(([url]) => url === "https://www.ksponco.or.kr/online/tennis/login.do")).toBe(true);
    expect(fake.page.locator).toHaveBeenCalledWith(OLYMPIC_LOGIN_SELECTORS.user);
    expect(fake.page.locator).toHaveBeenCalledWith(OLYMPIC_LOGIN_SELECTORS.password);
    expect(fake.page.locator).toHaveBeenCalledWith(OLYMPIC_LOGIN_SELECTORS.submit);
    expect(fake.page.url()).toBe("https://www.ksponco.or.kr/online/tennis/resrvtn_aplictn.do");
    expect(fake.page.waitForLoadState.mock.calls.some(([state]) => state === "networkidle")).toBe(false);
  });
  it("reports a changed login form instead of generic site slowness", async () => {
    const { ensureOlympicLoggedIn } = await importProvider();
    const fake = createPage({ bodyTexts: ["로그인 마이페이지"] });
    const locator = fake.page.locator.getMockImplementation();
    fake.page.locator.mockImplementation(selector => {
      const control = locator(selector);
      control.waitFor = vi.fn(async () => { throw new Error("Timeout waiting for user_id"); });
      return control;
    });
    await expect(ensureOlympicLoggedIn(fake.page)).rejects.toMatchObject({ type: "LOGIN_FORM_CHANGED", stage: "AUTH_OR_PROTECTION", retryable: false });
    expect(fake.fill).not.toHaveBeenCalled();
  });
  it("does not hide an authentication redirect as a successful session", async () => {
    const { ensureOlympicLoggedIn } = await importProvider();
    const fake = createPage({ reservationRedirect: "https://www.ksponco.or.kr/online/tennis/index.do" });
    await expect(ensureOlympicLoggedIn(fake.page)).rejects.toMatchObject({ type: "LOGIN_OR_PROTECTION_PAGE" });
    expect(fake.fill).not.toHaveBeenCalled();
  });
  it("does not submit credentials when checking the session fails to navigate", async () => {
    const { ensureOlympicLoggedIn } = await importProvider();
    const fake = createPage();
    fake.page.goto.mockRejectedValueOnce(new Error("page.goto: network timeout"));
    await expect(ensureOlympicLoggedIn(fake.page)).rejects.toThrow("network timeout");
    expect(fake.fill).not.toHaveBeenCalled();
  });
  it("rejects an unconfirmed login without claiming calendar access succeeded", async () => {
    const { ensureOlympicLoggedIn } = await importProvider();
    const fake = createPage({ bodyTexts: ["로그인 마이페이지 신청내역"] });
    await expect(ensureOlympicLoggedIn(fake.page)).rejects.toMatchObject({ type: "LOGIN_OR_PROTECTION_PAGE" });
    expect(fake.page.goto.mock.calls.some(([url]) => url.endsWith("/resrvtn_aplictn.do"))).toBe(false);
  });
});


it("identifies a WebGate challenge instead of reporting a generic slow calendar", async () => {
  const { waitForOlympicCalendar, readOlympicCalendar } = await importProvider();
  const page = {
    waitForFunction: vi.fn(async () => { throw new Error("page.waitForFunction: Timeout 30000ms exceeded"); }),
    content: async () => '<script src="https://cdn2.devy.kr/2120/js/webgate.js"></script>',
    locator: () => ({ innerText: async () => "" }),
    evaluate: vi.fn()
  };
  await expect(waitForOlympicCalendar(page)).rejects.toMatchObject({ type: "LOGIN_OR_PROTECTION_PAGE", stage: "AUTH_OR_PROTECTION" });
  await expect(readOlympicCalendar(page)).rejects.toMatchObject({ type: "LOGIN_OR_PROTECTION_PAGE" });
  expect(page.evaluate).not.toHaveBeenCalled();
});
it("does not mistake a loaded calendar's shared security script for a blocked page", async () => {
  const { isOlympicProtectionPage } = await importProvider();
  expect(isOlympicProtectionPage({ html: '<script src="webgate.js"></script>', body: "10 가능 3건 진행 0건 마감 9건" })).toBe(false);
});
