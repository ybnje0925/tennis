export class CookieSession {
  constructor(fetchImpl = fetch) {
    this.fetchImpl = fetchImpl;
    this.cookies = new Map();
  }

  cookieHeader() {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join("; ");
  }

  remember(response) {
    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("set-cookie") || "").split(/,(?=[^;]+=)/);
    for (const value of setCookies) {
      const pair = String(value).split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  async request(url, init = {}) {
    const headers = new Headers(init.headers || {});
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    const response = await this.fetchImpl(url, { ...init, headers, redirect: "manual" });
    this.remember(response);
    return response;
  }
}

