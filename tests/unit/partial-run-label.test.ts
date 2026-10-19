import { describe, expect, it } from "vitest";

import { evidenceLabel } from "@/components/workspace/imported-draft-panel";
import type { ImportedRunEvidence } from "@/lib/services/imported-drafts";

/**
 * What a reviewer is told about a run that did not finish.
 *
 * Found on 2026-10-19, walking a mock company to the moment of approval. The
 * lead opened a Test Case waiting for her decision and read "Partly run on
 * the live page, 7 checks passed" above an Approve button. One step -- the
 * page reload the test was written for -- had never run, and nothing on that
 * screen said so. The only number shown was the good news.
 *
 * A partial verdict is the one that can mislead by itself: nothing failed, so
 * it reads like a pass. The count of what did not run has to travel with it.
 */
const receipt = (over: Partial<ImportedRunEvidence>): ImportedRunEvidence => ({
  v: 1,
  codeSha256: "a".repeat(64),
  pageUrl: "https://demo.playwright.dev/todomvc/",
  verdict: "partial",
  passed: 7,
  failed: 0,
  skipped: 1,
  notReached: 0,
  tests: 1,
  durationMs: 3200,
  ranAt: "2026-10-18T20:44:00.000Z",
  ...over,
});

describe("the badge on imported code", () => {
  it("says how much did not run, not only how much passed", () => {
    const label = evidenceLabel(receipt({}), "page-coverage");
    expect(label.text).toContain("1 not run");
    expect(label.text).toContain("7 passed");
  });

  it("counts steps never reached as not run too", () => {
    // Both mean the same thing to a reviewer: that step was never exercised.
    const label = evidenceLabel(receipt({ skipped: 2, notReached: 3 }), "page-coverage");
    expect(label.text).toContain("5 not run");
  });

  it("does not put a 'not run' count on a run that finished", () => {
    const label = evidenceLabel(receipt({ verdict: "passed", skipped: 0 }), "page-coverage");
    expect(label.text).toBe("Passed on the live page · 7 checks");
    expect(label.text).not.toContain("not run");
  });

  it("still says plainly when the last run failed", () => {
    const label = evidenceLabel(receipt({ verdict: "failed", failed: 2 }), "page-coverage");
    expect(label.text).toContain("failed");
  });

  it("distinguishes code that was never run from code that ran partly", () => {
    expect(evidenceLabel(null, "editor").text).toBe("Not run by PlaywrightGen yet");
    expect(evidenceLabel(null, "page-coverage").text).toBe("Not run on the live page before import");
  });
});
