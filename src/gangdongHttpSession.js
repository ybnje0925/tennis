import { CookieSession } from "./httpSession.js";
import { config } from "./config.js";

const ORIGIN = "https://gdgd.igangdong.or.kr";
const redirects = [301, 302, 303, 307, 308];

function failure(type, message) {
  return Object.assign(new Error(message), { type });
}

export function isGangdongAuthenticationRequired(response, html) {
  // A blocked or unavailable endpoint is not evidence of an expired login.
  if (response.status === 403 || response.status === 429 || response.status >= 500) return false;
  const location = response.headers.get("location") || "";
  const calendar = /calendar1_table/i.test(html);
  return response.status === 401
    || (redirects.includes(response.status) && /\/bbs\/login(?:\.php)?(?:[?#]|$)/i.test(location))
    || (!calendar && (/<input\b[^>]*(?:type\s*=\s*["']?password|name\s*=\s*["']?mb_password)/i.test(html)
      || /로그인 후|아이디를 입력|비밀번호를 입력|자동로그아웃/.test(html)));
}

// Process-local only: no credentials or cookies are written to disk or logs.
export class GangdongHttpSession {
  constructor({ fetchImpl = (...args) => fetch(...args), username = config.gangdongUserId,
    password = config.gangdongUserPassword } = {}) {
    this.fetchImpl = fetchImpl;
    this.username = username;
    this.password = password;
    this.session = new CookieSession(fetchImpl);
    this.ready = false;
    this.generation = 0;
    this.loginPromise = null;
  }

  async request(url, init = {}) {
    try {
      return await this.session.request(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw failure("NETWORK_ERROR", "강동 HTTP 통신 실패 또는 제한시간 초과");
    }
  }

  async readText(response) {
    try { return await response.text(); }
    catch { throw failure("NETWORK_ERROR", "강동 HTTP 응답 수신 실패 또는 제한시간 초과"); }
  }

  async ensureLogin(expiredGeneration = null) {
    if (this.loginPromise) return this.loginPromise;
    if (this.ready && (expiredGeneration === null || expiredGeneration !== this.generation)) return;
    this.loginPromise = this.login();
    try { await this.loginPromise; } finally { this.loginPromise = null; }
  }

  async login() {
    this.ready = false;
    if (!this.username || !this.password) {
      throw failure("LOGIN_OR_PROTECTION_PAGE", "강동 로그인 설정이 필요합니다.");
    }
    this.session = new CookieSession(this.fetchImpl);
    const form = await this.request(`${ORIGIN}/bbs/login.php`);
    // Consume bodies while the request's timeout is active.
    await this.readText(form);
    if (!form.ok) throw failure("HTTP_BLOCKED_OR_NOT_FOUND", `강동 로그인 페이지 HTTP ${form.status}`);
    const response = await this.request(`${ORIGIN}/bbs/login_check.php`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", referer: `${ORIGIN}/bbs/login.php` },
      body: new URLSearchParams({ rtn_url: ORIGIN, rtn_par: "", mb_id: this.username, mb_password: this.password })
    });
    await this.readText(response);
    if (!redirects.includes(response.status) || /\/bbs\/login\.php/i.test(response.headers.get("location") || "")) {
      throw failure("LOGIN_OR_PROTECTION_PAGE", `강동 로그인 인증 실패 (HTTP ${response.status})`);
    }
    // The next requested calendar confirms authentication without a separate probe.
    this.ready = true;
    this.generation++;
  }

  async calendar(url) {
    await this.ensureLogin();
    for (let attempt = 0; attempt < 2; attempt++) {
      const generation = this.generation;
      const response = await this.request(url, { headers: { referer: `${ORIGIN}/` } });
      const html = await this.readText(response);
      if (/WebGate|WG_StartWebGate|접근\s*차단|비정상/i.test(html)) {
        throw failure("LOGIN_OR_PROTECTION_PAGE", "강동 예약 달력 접근 제한 응답입니다.");
      }
      if (isGangdongAuthenticationRequired(response, html)) {
        if (attempt === 0) {
          await this.ensureLogin(generation);
          continue;
        }
        this.ready = false;
        throw failure("LOGIN_OR_PROTECTION_PAGE", "강동 재로그인 후에도 예약 달력 인증을 확인하지 못했습니다.");
      }
      if (!response.ok) throw failure("HTTP_BLOCKED_OR_NOT_FOUND", `강동 예약 달력 HTTP ${response.status}`);
      if (!/calendar1_table/i.test(html)) throw failure("PARSE_FAILED", "강동 예약 달력 구조를 확인하지 못했습니다.");
      return html;
    }
  }
}

export const gangdongHttpSession = new GangdongHttpSession();
