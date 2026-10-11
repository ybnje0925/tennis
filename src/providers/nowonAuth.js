import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { CookieSession } from '../httpSession.js';
import { diagnosticError } from '../diagnostics.js';

export const NOWON_ORIGIN = 'https://reservation.nowonsc.kr';
const error = (type, message, stage = 'AUTH_OR_PROTECTION', retryable = false) => diagnosticError({ provider: 'nowon', type, stage, message, retryable });
export function isNowonLoginPage(html, url = '') {
  return /\/member\/login(?:[;?/#]|$)/i.test(url) || /<input\b[^>]*name=["']memberPassword["']/i.test(html);
}
export function classifyNowonLoginResult(data) {
  if (data?.result === 0) return null; // Observed login.js, not HTTP status.
  if (data?.result === 12) return error('NOWON_CREDENTIALS_INVALID', '노원 자격증명 오류: 운영자 조치 후 인증 재개가 필요합니다.');
  if ([14, 15].includes(data?.result)) return error('NOWON_ACCOUNT_LOCKED', '노원 계정 차단: 공식 사이트에서 운영자 조치가 필요합니다.');
  if ([11, 13].includes(data?.result)) return error('NOWON_ADDITIONAL_AUTH', '노원 비밀번호 변경 또는 휴면 해제 확인이 필요합니다.');
  return error('NOWON_AUTH_UNCONFIRMED', '노원 로그인 결과를 확인하지 못했습니다. 자동 로그인을 중단합니다.');
}

// Never attach raw responses, credentials, URLs, cookies or server text to errors.
// A persistent stop file protects against retrying bad passwords after restarts.
export class NowonAuth {
  #session; #loginPromise = null; #ready = false; #generation = 0;
  #username; #password; #stop; #stopFile; #loaded = false; #fetch; #sleep;
  constructor({ username = config.nowonUsername, password = config.nowonPassword, fetchImpl = fetch,
    stopFile = path.resolve(config.dataDir, 'nowon-auth-stop.json'), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    this.#username = username; this.#password = password; this.#fetch = fetchImpl;
    this.#session = new CookieSession(fetchImpl); this.#stopFile = stopFile; this.#sleep = sleep;
  }
  async #loadStop() {
    if (this.#loaded) return;
    if (this.#stopFile) {
      try { const saved = JSON.parse(await readFile(this.#stopFile, 'utf8')); this.#stop = error(saved.type, '노원 자동 인증 중단: 운영자 조치 후 재개가 필요합니다.'); }
      catch (e) { if (e.code !== 'ENOENT') throw error('NOWON_AUTH_UNCONFIRMED', '노원 인증 중단 기록을 읽을 수 없습니다.'); }
    }
    this.#loaded = true;
  }
  async #halt(failure) {
    this.#stop = failure; this.#ready = false;
    if (this.#stopFile) {
      await mkdir(path.dirname(this.#stopFile), { recursive: true });
      await writeFile(this.#stopFile, JSON.stringify({ type: failure.type, stoppedAt: new Date().toISOString() }), { mode: 0o600 });
    }
  }
  async resume() {
    if (this.#loginPromise) throw error('NOWON_AUTH_UNCONFIRMED', '인증 진행 중에는 재개할 수 없습니다.');
    if (this.#stopFile) await rm(this.#stopFile, { force: true });
    this.#stop = null; this.#loaded = true; this.#ready = false;
  }
  async #request(relative, init = {}, retryGet = true) {
    const url = new URL(relative, NOWON_ORIGIN);
    if (url.origin !== NOWON_ORIGIN || url.username || url.password) throw error('NOWON_AUTH_UNCONFIRMED', '노원 요청 주소 확인이 필요합니다.');
    const isGet = !init.method || init.method === 'GET';
    for (let attempt = 0; ; attempt++) {
      try {
        let target = url.href;
        for (let redirect = 0; redirect < 6; redirect++) {
          const response = await this.#session.request(target, { ...init, signal: AbortSignal.timeout(15000) });
          if ([301,302,303,307,308].includes(response.status)) {
            if (!isGet) return response;
            const location = response.headers.get('location');
            if (!location) throw error('NOWON_AUTH_UNCONFIRMED', '노원 이동 응답을 확인하지 못했습니다.');
            const next = new URL(location, target);
            if (next.origin !== NOWON_ORIGIN) throw error('NOWON_ADDITIONAL_AUTH', '노원 외부 인증 확인이 필요합니다.');
            target = next.href;
            continue;
          }
          if (response.status >= 500 || response.status === 429) throw error('NETWORK_ERROR', '노원 일시적인 통신 오류입니다.', 'HTTP', true);
          if (!response.ok) throw error('HTTP_BLOCKED_OR_NOT_FOUND', '노원 접근 제한 또는 HTTP 조회 오류입니다.', 'HTTP');
          const html = await response.text();
          if (/captcha|g-recaptcha|hcaptcha|추가\s*인증|자동입력\s*방지/i.test(html)) throw error('NOWON_ADDITIONAL_AUTH', '노원 추가 인증이 필요합니다. 자동 인증을 중단합니다.');
          return { status: response.status, url: target, html, headers: response.headers };
        }
        throw error('NOWON_AUTH_UNCONFIRMED', '노원 페이지 이동 횟수가 초과되었습니다.');
      } catch (e) {
        const failure = e?.type ? e : error('NETWORK_ERROR', '노원 네트워크 연결에 실패했습니다.', 'HTTP', true);
        if (isGet && retryGet && failure.retryable && attempt === 0) { await this.#sleep(750); continue; }
        throw failure;
      }
    }
  }
  async ensureLogin(expiredGeneration = null) {
    await this.#loadStop();
    if (!this.#username || !this.#password) throw error('NOWON_LOGIN_CONFIG_REQUIRED', '노원 로그인 설정 필요');
    if (this.#stop) throw this.#stop;
    if (this.#loginPromise) return this.#loginPromise;
    if (this.#ready && (expiredGeneration == null || this.#generation !== expiredGeneration)) return;
    this.#loginPromise = this.#login();
    try { await this.#loginPromise; } finally { this.#loginPromise = null; }
  }
  async #login() {
    this.#ready = false; this.#session = new CookieSession(this.#fetch);
    try {
      const page = await this.#request('/member/login');
      const form = page.html.match(/<form\b[^>]*id=["']frm["'][^>]*>([\s\S]*?)<\/form>/i)?.[1];
      if (!form || !/name=["']memberId["']/.test(form) || !/name=["']memberPassword["']/.test(form)) throw error('NOWON_AUTH_UNCONFIRMED', '노원 로그인 폼이 변경되었습니다.');
      const body = new URLSearchParams();
      // Forward hidden fields from the observed form; no invented CSRF field.
      for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
        if (!/type=["']hidden["']/i.test(tag)) continue;
        const name = tag.match(/name=["']([^"']+)["']/i)?.[1];
        const value = tag.match(/value=["']([^"']*)["']/i)?.[1] || '';
        if (name) body.set(name, value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
      }
      body.set('memberId', this.#username); body.set('memberPassword', this.#password);
      // Record before POST so interrupted/ambiguous attempts cannot repeat after restart.
      await this.#halt(error('NOWON_AUTH_UNCONFIRMED', '노원 로그인 결과 미확인: 운영자 확인이 필요합니다.'));
      const reply = await this.#request('/member/loginAction', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: NOWON_ORIGIN, referer: NOWON_ORIGIN + '/member/login' }, body }, false);
      let data; try { data = JSON.parse(reply.html); } catch { throw error('NOWON_AUTH_UNCONFIRMED', '노원 로그인 JSON 응답을 확인하지 못했습니다.'); }
      const failure = classifyNowonLoginResult(data); if (failure) throw failure;
      const confirmation = await this.#request('/sports/tennis_list');
      // Success code + authenticated logout link; public member menu is insufficient.
      if (isNowonLoginPage(confirmation.html, confirmation.url) || !/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*로그아웃(?:(?!<\/a>)[\s\S])*<\/a>/i.test(confirmation.html)) throw error('NOWON_AUTH_UNCONFIRMED', '노원 로그인 이후 인증 상태를 확인하지 못했습니다.');
      if (this.#stopFile) await rm(this.#stopFile, { force: true });
      this.#stop = null; this.#ready = true; this.#generation++;
    } catch (e) {
      let failure = e?.type ? e : error('NOWON_AUTH_UNCONFIRMED', '노원 인증 처리에 실패했습니다.');
      if (this.#stop && failure.retryable) failure = error("NOWON_AUTH_UNCONFIRMED", "노원 로그인 결과가 불확실합니다. 운영자 확인 전 재시도하지 않습니다.");
      if (!failure.retryable || this.#stop) await this.#halt(failure);
      throw failure;
    }
  }
  async get(relative) {
    await this.ensureLogin();
    const generation = this.#generation;
    let response;
    try { response = await this.#request(relative); }
    catch (failure) { if (failure.type === "NOWON_ADDITIONAL_AUTH") await this.#halt(failure); throw failure; }
    if (!isNowonLoginPage(response.html, response.url)) return response;
    await this.ensureLogin(generation);
    try { response = await this.#request(relative); }
    catch (failure) { if (failure.type === "NOWON_ADDITIONAL_AUTH") await this.#halt(failure); throw failure; }
    if (isNowonLoginPage(response.html, response.url)) {
      const failure = error('NOWON_AUTH_UNCONFIRMED', '노원 재로그인 후에도 로그인 화면이 반환됩니다.');
      await this.#halt(failure); throw failure;
    }
    return response;
  }
}
export const nowonAuth = new NowonAuth();
