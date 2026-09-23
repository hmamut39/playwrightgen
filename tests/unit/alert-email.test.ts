import { describe, expect, it } from "vitest";

import { alertSubject, looksLikeEmail } from "@/lib/services/alert-email";

/**
 * The address is what stops this becoming a way to mail strangers, so what it
 * refuses matters more than what it accepts. Membership is checked separately;
 * this is only the shape.
 */
describe("an address a daily check can be mailed to", () => {
  it("accepts an ordinary address", () => {
    for (const address of ["lead@team.example", "qa+alerts@team.co.uk", "a.b-c@sub.domain.org"]) {
      expect(looksLikeEmail(address)).toBe(true);
    }
  });

  it("refuses what is not one", () => {
    for (const address of [
      "",
      "   ",
      "lead",
      "lead@",
      "@team.example",
      "lead@team",
      "lead @team.example",
      "lead@team .example",
      "two@addresses.example,three@addresses.example",
      `${"a".repeat(320)}@team.example`,
    ]) {
      expect(looksLikeEmail(address)).toBe(false);
    }
  });
});

describe("the subject line", () => {
  it("leads with what broke, because that is what makes someone open it", () => {
    expect(alertSubject("Shop", 1, 0)).toBe("Shop: 1 test started failing today");
    expect(alertSubject("Shop", 3, 2)).toBe("Shop: 3 tests started failing today");
  });

  it("says the good news when there is only good news", () => {
    expect(alertSubject("Shop", 0, 1)).toBe("Shop: 1 test passing again");
    expect(alertSubject("Shop", 0, 2)).toBe("Shop: 2 tests passing again");
  });

  it("stays plain when nothing changed", () => {
    expect(alertSubject("Shop", 0, 0)).toBe("Shop: daily check");
  });
});
