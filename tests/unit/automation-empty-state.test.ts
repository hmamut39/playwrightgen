import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { automationEmptyState } from "@/lib/services/automation-empty-state";

/**
 * What an empty screen says to somebody who has just arrived.
 *
 * The welcome screen promises "Every screen after this tells you what to do
 * next". That is a claim about every other page in the workspace, and the
 * Automation page was breaking it: "Open an approved Test Case and choose
 * the Browser or API engine" names a thing a first-week project does not
 * have, does not say how to get one, and links nowhere.
 */
const base = "/workspace/acme/projects/p1";

describe("an Automation page with nothing on it", () => {
  it("sends somebody with no test cases to where the chain starts", () => {
    const state = automationEmptyState({ testCases: 0, approved: 0 }, base);

    expect(state.action.href).toBe(`${base}/test-cases`);
    expect(state.detail).toContain("approved");
  });

  it("sends somebody whose work is waiting for a person to the review queue", () => {
    /*
     * The case the old message got most wrong. Four drafts written and none
     * approved is not "go and write a test case"; the writing is done and a
     * person is the thing missing.
     */
    const state = automationEmptyState({ testCases: 4, approved: 0 }, base);

    expect(state.action.href).toBe(`${base}/reviews`);
    expect(state.detail).toContain("4 test cases");
    expect(state.title).toContain("approval");
  });

  it("reads correctly for exactly one test case", () => {
    const state = automationEmptyState({ testCases: 1, approved: 0 }, base);

    expect(state.detail).toContain("one test case");
    expect(state.detail).not.toContain("1 test cases");
  });

  it("gives the original instruction once it can actually be followed", () => {
    const state = automationEmptyState({ testCases: 4, approved: 2 }, base);

    expect(state.detail).toContain("Browser or API engine");
    expect(state.action.href).toBe(`${base}/test-cases`);
  });

  it("always offers somewhere to go", () => {
    for (const counts of [
      { testCases: 0, approved: 0 },
      { testCases: 3, approved: 0 },
      { testCases: 3, approved: 3 },
    ]) {
      const state = automationEmptyState(counts, base);
      expect(state.action.label.length, JSON.stringify(counts)).toBeGreaterThan(3);
      expect(state.action.href.startsWith(base), JSON.stringify(counts)).toBe(true);
      expect(state.detail.length).toBeGreaterThan(60);
    }
  });
});

describe("the promise the welcome screen makes about every other screen", () => {
  it("is kept by every list in the workspace", () => {
    /*
     * "Every screen after this tells you what to do next" is on
     * app/onboarding/page.tsx. This checks the claim rather than trusting
     * it: each list page's empty state has to offer a link, which is the
     * difference between being told what exists and being able to get
     * there. Automation was the one that did not, and nothing would have
     * said so.
     */
    const lists = ["requirements", "test-cases", "automation", "test-runs", "cover", "reviews"];

    const withoutAWayOut = lists.filter((list) => {
      const source = readFileSync(
        `app/workspace/[orgSlug]/projects/[projectId]/${list}/page.tsx`,
        "utf8",
      );
      // The empty branch, then whether anything in the page can be clicked
      // from it. Crude on purpose: a page that renders no link at all cannot
      // be telling anybody where to go.
      const empty = source.match(/\.length\s*(===\s*0|\?)[\s\S]{0,2000}/)?.[0] ?? "";
      return !/<Link|href=|action:/.test(empty);
    });

    expect(withoutAWayOut, "an empty screen with nowhere to go").toEqual([]);
  });

  it("still says it, so this test is about something real", () => {
    // If the promise is ever dropped from the welcome screen, the test above
    // is guarding a rule nobody made any more and should be reconsidered
    // rather than quietly kept.
    const welcome = readFileSync("app/onboarding/page.tsx", "utf8");

    expect(welcome).toContain("tells you what to do next");
  });
});
