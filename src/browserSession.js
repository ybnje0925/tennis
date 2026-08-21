import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config, assertLoginConfig } from "./config.js";
import { LOGIN_URL } from "./constants.js";

const SESSION_DIR = path.resolve("sessions", "gangdong-profile");

export async function openGangdongSession(options = {}) {
  await mkdir(SESSION_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: options.headless ?? config.headless,
    viewport: { width: 1365, height: 900 },
    locale: "ko-KR"
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20_000);
  return { context, page };
}

export async function ensureLoggedIn(page) {
  if (await isLoggedIn(page)) return true;

  assertLoginConfig();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  await page.locator("input[name='mb_id'], input[name='user_id'], input[type='text']").first().fill(config.gangdongUserId);
  await page.locator("input[name='mb_password'], input[name='password'], input[type='password']").first().fill(config.gangdongUserPassword);

  const submit = page.locator("button[type='submit'], input[type='submit'], button:has-text('로그인'), input[value*='로그인']").first();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => {}),
    submit.click()
  ]);
  await page.waitForTimeout(1200);

  return isLoggedIn(page);
}

export async function isLoggedIn(page) {
  await page.goto("https://gdgd.igangdong.or.kr", { waitUntil: "domcontentloaded" }).catch(() => {});
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  return /로그아웃|마이페이지|회원정보|정보수정/.test(body);
}

export async function looksLikeProtectionOrLogin(page) {
  const body = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const url = page.url();
  return /WebGate|접근\s*차단|비정상|로그인 후|아이디|비밀번호/.test(body) || url.includes("/bbs/login.php");
}
