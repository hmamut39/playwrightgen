import { describe, expect, it } from "vitest";

import { failedCoverageDetail } from "@/lib/services/page-coverage";

/**
 * What a person is told when "Cover a page" could not get a test passing.
 *
 * Of the three outcomes it is the only one that asks somebody to do
 * something, and it was the one told least. A partial run lists every line the
 * preview refused and why. A failed run said "still failing after the
 * automatic fixes" and stopped -- while the failure sat in hand, two lines
 * from a function already imported in that file and already used to feed the
 * automatic fixer.
 *
 * The owner met it on 2026-11-08, setting up the demo account: one of four
 * tests on the demo page failed, the card said that and nothing else, and the
 * only way to learn which line broke was to open the draft and read it.
 */
describe("what a failed coverage item says", () => {
  const failure = {
    line: "await expect(page.getByRole('status')).toContainText('1 item left')",
    reason: "locator.innerText: Timeout 1000ms exceeded.\n  Call log:\n  - waiting for getByRole('status')",
  };

  it("names the line that failed and what the page said", () => {
    const detail = failedCoverageDetail({ stopped: "out_of_fixes", failure });
    const [first, ...rest] = detail.split("\n");

    expect(first).toContain("the code is kept for a person to finish");
    // Under the sentence, not inside it: the page renders the rest as lines.
    expect(rest).toHaveLength(1);
    expect(rest[0]).toContain("getByRole('status')");
    expect(rest[0]).toContain("Timeout 1000ms exceeded");
  });

  it("flattens the page's own words onto one line", () => {
    // A call log arrives with newlines in it. Left alone it would be rendered
    // as several bullets, each a fragment of one sentence.
    const detail = failedCoverageDetail({ stopped: "out_of_fixes", failure });

    expect(detail.split("\n")).toHaveLength(2);
  });

  it("does not invent a failure when the run never recorded one", () => {
    const detail = failedCoverageDetail({ stopped: "not_fixable", failure: null });

    expect(detail).toBe("Still failing after the automatic fixes; the code is kept for a person to finish.");
    expect(detail).not.toContain("-");
  });

  it("says the allowance ran out when that is what happened", () => {
    // Not a failing test at all, and telling somebody to go and fix one would
    // send them looking for a defect that is not there.
    const detail = failedCoverageDetail({ stopped: "limit", failure });

    expect(detail).toBe("Stopped when the AI allowance ran out.");
  });

  it("keeps a very long reason to something a row can carry", () => {
    const detail = failedCoverageDetail({
      stopped: "out_of_fixes",
      failure: { line: "await expect(a).toBe(b)", reason: "x".repeat(2_000) },
    });

    expect(detail.length).toBeLessThan(400);
    expect(detail).toContain("await expect(a).toBe(b)");
  });
});
