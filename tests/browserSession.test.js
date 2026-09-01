import { describe, expect, it } from "vitest";
import { looksLikeProtectionOrLogin } from "../src/browserSession.js";

describe("looksLikeProtectionOrLogin", () => {
  it("detects script-only WebGate protection pages", async () => {
    const page = {
      url: () => "https://gdgd.igangdong.or.kr/page/rent/s01.od.list.php",
      content: async () => "<script>WG_StartWebGate('17898', window.location.href, 'BACKEND');</script>",
      locator: () => ({
        innerText: async () => ""
      })
    };

    await expect(looksLikeProtectionOrLogin(page)).resolves.toBe(true);
  });
});
