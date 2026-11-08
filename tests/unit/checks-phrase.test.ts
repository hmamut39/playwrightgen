import { describe, expect, it } from "vitest";

import { checksCount, checksPhrase } from "@/lib/free-tools/preview-run/checks-phrase";

/**
 * The number under "proven on your real page" has to be the one a tester would
 * count. It was the operation total: a goto, a fill and a press each counted as
 * a check, so a test with three assertions and four actions said "7 checks
 * passed". These tests fail if that comes back.
 */
describe("what a live run says it checked", () => {
  it("says checks when the run counted assertions apart from the actions", () => {
    expect(checksPhrase({ passed: 7, checks: 3 })).toBe("3 checks");
  });

  it("does not round a single check up to a plural", () => {
    expect(checksPhrase({ passed: 4, checks: 1 })).toBe("1 check");
  });

  it("says a test with no assertions checked nothing, rather than borrowing the step count", () => {
    // A generated test that only clicks through a page has proved nothing, and
    // the number beside the claim is the one place that can say so.
    expect(checksPhrase({ passed: 6, checks: 0 })).toBe("0 checks");
  });

  it("calls the old records steps, because that is the number that was kept", () => {
    // Runs recorded before assertions were counted carry only the operation
    // total. Calling it a check now would be the same overstatement, backdated.
    expect(checksPhrase({ passed: 7 })).toBe("7 steps");
    expect(checksPhrase({ passed: 1, checks: null })).toBe("1 step");
  });

  it("never dresses the operation count as a check count", () => {
    for (const passed of [0, 1, 5, 42]) {
      expect(checksPhrase({ passed })).not.toContain("check");
    }
  });

  it("offers null rather than a number a caller would have to invent", () => {
    expect(checksCount({ checks: 0 })).toBe(0);
    expect(checksCount({})).toBeNull();
  });
});
