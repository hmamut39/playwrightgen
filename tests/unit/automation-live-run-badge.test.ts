import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { automationLiveRunBadge } from "@/lib/workspace/automation-live-run-badge";

/**
 * The badge over a generated test, and the two numbers it used to mix.
 *
 * A partial run showed "Partly run on the live page · 16 passed" directly
 * above "5 checks passed, 2 steps could not run there". Both are true and
 * they count different things -- operations and assertions -- and nothing on
 * the screen said which was which. Found on 2026-11-21 by walking a new team
 * from an empty project to a generated test.
 */
describe("what the badge says about a run", () => {
  it("counts assertions when it passed", () => {
    expect(automationLiveRunBadge({ verdict: "passed", passed: 16, checks: 5 }).text).toBe(
      "Passed on the live page · 5 checks",
    );
  });

  it("counts the same thing when it only partly ran", () => {
    /*
     * The fault. This said "16 passed" -- every goto, fill and press -- while
     * the sentence underneath said five checks.
     */
    const badge = automationLiveRunBadge({ verdict: "partial", passed: 16, checks: 5, notRun: 2 });

    expect(badge.text).toContain("5 checks passed");
    expect(badge.text).not.toContain("16");
  });

  it("says how much did not run, which is what partly means", () => {
    expect(automationLiveRunBadge({ verdict: "partial", passed: 9, checks: 3, notRun: 1 }).text).toContain(
      "1 step could not run",
    );
    expect(automationLiveRunBadge({ verdict: "partial", passed: 9, checks: 3, notRun: 4 }).text).toContain(
      "4 steps could not run",
    );
  });

  it("falls back to steps for a run recorded before assertions were counted", () => {
    // checksPhrase says "steps" when the stored run predates counting them,
    // rather than calling an operation a check with a later date on it.
    const badge = automationLiveRunBadge({ verdict: "partial", passed: 7, notRun: 0 });

    expect(badge.text).toContain("7 steps passed");
  });

  it("claims nothing at all when it failed", () => {
    expect(automationLiveRunBadge({ verdict: "failed", passed: 3, checks: 1 })).toEqual({
      text: "Did not pass on the live page",
      tone: "failed",
    });
  });
});

describe("where the badge is rendered", () => {
  it("is built in one place rather than assembled on the page", () => {
    /*
     * The original fault was two branches of one ternary counting different
     * things. One helper for all three verdicts is what stops that recurring
     * -- so the page must not be counting anything itself.
     */
    const page = readFileSync(
      "app/workspace/[orgSlug]/projects/[projectId]/automation/[automationArtifactId]/page.tsx",
      "utf8",
    );

    expect(page).toContain("automationLiveRunBadge");
    expect(page).not.toContain("Partly run on the live page · ${liveRun.passed}");
  });
});
