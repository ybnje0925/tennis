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
    currentUrl = options.afterClickUrl || "https://www.ksponco.or.kr/online/tennis/resrvtn_aplictn.do";
  });

  return {
    fill,
    accept,
    dismiss,
    page: {
      isClosed: () => false,
      setDefaultTimeout: vi.fn(),
      goto: vi.fn(async (url) => {
        currentUrl = url;
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
    const context = { pages: () => [fake.page], close: vi.fn() };
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
    const context1 = { pages: () => [fake1.page], close: vi.fn() };
    const fake2 = createPage();
    const context2 = { pages: () => [fake2.page], close: vi.fn() };
    launchPersistentContext.mockResolvedValueOnce(context1).mockResolvedValueOnce(context2);

    const first = await openOlympicSession();
    await first.context.close();
    const second = await openOlympicSession();

    expect(first.context).not.toBe(second.context);
    expect(second.sessionSource).toBe("restored");
    expect(launchPersistentContext).toHaveBeenCalledTimes(2);
  });
});
