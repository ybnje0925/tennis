import { describe, expect, it } from "vitest";
import { PROVIDERS, VENUES } from "../src/constants.js";

const AUTH_QUERY = /(?:token|session|cookie|storage|state|auth|sid|jwt)=/i;

describe("public reservation links", () => {
  it("exposes only plain https public URLs for venue links", () => {
    for (const venue of Object.values(VENUES)) {
      const url = new URL(venue.publicUrl);

      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(AUTH_QUERY.test(url.search)).toBe(false);
    }
  });

  it("exposes only plain https public URLs for provider links", () => {
    for (const provider of Object.values(PROVIDERS)) {
      const url = new URL(provider.publicUrl);

      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(AUTH_QUERY.test(url.search)).toBe(false);
    }
  });
});
