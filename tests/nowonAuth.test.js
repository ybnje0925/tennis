import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NowonAuth, classifyNowonLoginResult, isNowonLoginPage } from '../src/providers/nowonAuth.js';
const loginHtml = readFileSync(new URL('./fixtures/nowon-login.html', import.meta.url), 'utf8');
const okPage = '<a href="javascript:logOut();">로그아웃</a>';
const response = (html, status = 200, headers = {}) => new Response(html, { status, headers });
function harness(result = 0) {
  let authenticated = false, posts = 0, expire = false;
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/member/login') return response(loginHtml, 200, { 'set-cookie': 'JSESSIONID=mock-session; Path=/; HttpOnly' });
    if (pathname === '/member/loginAction') {
      posts++; authenticated = result === 0;
      expect(new URLSearchParams(init.body).get('memberId')).toBe('mock-user');
      expect(new URLSearchParams(init.body).get('memberPassword')).toBe('mock-password');
      expect(init.headers.get('cookie')).toContain('JSESSIONID=mock-session');
      return response(JSON.stringify({ result }));
    }
    if (pathname === '/sports/tennis_list') return response(authenticated ? okPage : loginHtml);
    if (expire) { authenticated = false; expire = false; }
    return response(authenticated ? '<div>mock-detail</div>' : loginHtml);
  });
  const auth = new NowonAuth({ username: 'mock-user', password: 'mock-password', fetchImpl, stopFile: null, sleep: async () => {} });
  return { auth, fetchImpl, posts: () => posts, expire: () => { expire = true; } };
}
describe('Nowon observed login protocol', () => {
  it('detects the actual anonymous HTML at HTTP 200 and URL session redirects', () => {
    expect(isNowonLoginPage(loginHtml)).toBe(true);
    expect(isNowonLoginPage('', 'https://reservation.nowonsc.kr/member/login;jsessionid=mock-only?ret=x')).toBe(true);
    expect(isNowonLoginPage('<nav>로그인 마이페이지</nav>')).toBe(false);
  });
  it.each([[12, 'NOWON_CREDENTIALS_INVALID'], [14, 'NOWON_ACCOUNT_LOCKED'], [15, 'NOWON_ACCOUNT_LOCKED'], [11, 'NOWON_ADDITIONAL_AUTH'], [13, 'NOWON_ADDITIONAL_AUTH']])('classifies observed result %s', (result, type) => {
    expect(classifyNowonLoginResult({ result }).type).toBe(type);
  });
  it('requires explicit success and does not accept unexpected result shapes', () => {
    expect(classifyNowonLoginResult({ result: 0 })).toBeNull();
    expect(classifyNowonLoginResult({ result: '0' }).type).toBe('NOWON_AUTH_UNCONFIRMED');
    expect(classifyNowonLoginResult({ status: 200 }).type).toBe('NOWON_AUTH_UNCONFIRMED');
  });
  it('logs in once across simultaneous users/facilities and reuses cookies', async () => {
    const h = harness(); await Promise.all([h.auth.get('/a'), h.auth.get('/b'), h.auth.get('/c')]);
    await h.auth.get('/d'); expect(h.posts()).toBe(1);
    expect(JSON.stringify(h.auth)).not.toMatch(/mock-user|mock-password|mock-session/);
  });
  it('relogs once after expiry even when simultaneous readers detect expiry', async () => {
    const h = harness(); await h.auth.get('/a'); h.expire();
    await Promise.all([h.auth.get('/a'), h.auth.get('/b')]); expect(h.posts()).toBe(2);
  });
  it('stops automatic credential retries until explicit operator resume', async () => {
    const h = harness(12);
    await expect(h.auth.get('/a')).rejects.toMatchObject({ type: 'NOWON_CREDENTIALS_INVALID' });
    await expect(h.auth.get('/a')).rejects.toMatchObject({ type: 'NOWON_CREDENTIALS_INVALID' });
    expect(h.posts()).toBe(1);
    await h.auth.resume(); await expect(h.auth.get('/a')).rejects.toMatchObject({ type: 'NOWON_CREDENTIALS_INVALID' });
    expect(h.posts()).toBe(2);
  });
  it('does not accept success JSON when confirmation is an anonymous page', async () => {
    const h = harness(); const original = h.fetchImpl.getMockImplementation();
    h.fetchImpl.mockImplementation((url, init) => new URL(url).pathname === '/sports/tennis_list' ? Promise.resolve(response(loginHtml)) : original(url, init));
    await expect(h.auth.get('/a')).rejects.toMatchObject({ type: 'NOWON_AUTH_UNCONFIRMED' });
  });
  it('does not POST with missing environment config', async () => {
    const fetchImpl = vi.fn();const auth = new NowonAuth({ username: '', password: '', fetchImpl, stopFile: null });
    await expect(auth.get('/a')).rejects.toMatchObject({ type: 'NOWON_LOGIN_CONFIG_REQUIRED' }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('retries GET network errors once but never logs raw error secrets', async () => {
    const h = harness();h.fetchImpl.mockRejectedValueOnce(new Error('mock-password JSESSIONID=secret'));
    await h.auth.get('/a');expect(h.posts()).toBe(1);
    const failing = new NowonAuth({ username: 'mock', password: 'mock', fetchImpl: vi.fn(async () => { throw Error('mock-password JSESSIONID=secret'); }), stopFile: null, sleep: async () => {} });
    await expect(failing.get('/a')).rejects.toMatchObject({ message: '노원 네트워크 연결에 실패했습니다.' });
  });
  it('does not resend ambiguous login POST after a network failure', async () => {
    const h = harness(); const original=h.fetchImpl.getMockImplementation();
    h.fetchImpl.mockImplementation((url,init)=>new URL(url).pathname==='/member/loginAction'?Promise.reject(Error('network')):original(url,init));
    await expect(h.auth.get('/a')).rejects.toMatchObject({ type: 'NOWON_AUTH_UNCONFIRMED' });
    await expect(h.auth.get('/a')).rejects.toMatchObject({ type: 'NOWON_AUTH_UNCONFIRMED' });
    expect(h.fetchImpl.mock.calls.filter(([url])=>new URL(url).pathname==='/member/loginAction')).toHaveLength(1);
  });
  it('stops for additional authentication rather than bypassing it', async () => {
    const fetchImpl=vi.fn(async()=>response('<div class="g-recaptcha">추가 인증</div>'));
    const auth=new NowonAuth({username:'mock',password:'mock',fetchImpl,stopFile:null});
    await expect(auth.get('/a')).rejects.toMatchObject({type:'NOWON_ADDITIONAL_AUTH'});
    await expect(auth.get('/a')).rejects.toMatchObject({type:'NOWON_ADDITIONAL_AUTH'});expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

it('persists credential failures across a new server instance without storing secrets', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'tennis-nowon-auth-'));
  try {
    const stopFile=path.join(dir,'stop.json');let posts=0;
    const fetchImpl=vi.fn(async (url)=>{
      if(new URL(url).pathname==='/member/login')return response(loginHtml);
      posts++;return response(JSON.stringify({result:12}));
    });
    const args={username:'mock-user',password:'mock-password',fetchImpl,stopFile};
    await expect(new NowonAuth(args).get('/a')).rejects.toMatchObject({type:'NOWON_CREDENTIALS_INVALID'});
    const saved=await readFile(stopFile,'utf8');expect(saved).not.toMatch(/mock-user|mock-password|cookie|JSESSIONID|csrf/i);
    await expect(new NowonAuth(args).get('/a')).rejects.toMatchObject({type:'NOWON_CREDENTIALS_INVALID'});expect(posts).toBe(1);
  } finally {
    if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(dir).startsWith('tennis-nowon-auth-'))throw Error('Unsafe cleanup');
    await rm(dir,{recursive:true,force:true});
  }
});
it('reexecutes an expired request at most once and latches repeated expiry', async () => {
  const h=harness();const original=h.fetchImpl.getMockImplementation();
  h.fetchImpl.mockImplementation((url,init)=>new URL(url).pathname==='/always-expired'?Promise.resolve(response(loginHtml)):original(url,init));
  await expect(h.auth.get('/always-expired')).rejects.toMatchObject({type:'NOWON_AUTH_UNCONFIRMED'});
  expect(h.posts()).toBe(2);
  await expect(h.auth.get('/always-expired')).rejects.toMatchObject({type:'NOWON_AUTH_UNCONFIRMED'});expect(h.posts()).toBe(2);
});
