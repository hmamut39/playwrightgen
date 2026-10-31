import { describe, expect, it } from "vitest";

import { unlinkedTestsNote } from "@/lib/services/release-evidence";

/**
 * The sentence an outsider reads about approved tests that verify no
 * requirement.
 *
 * Its first draft said they "have run against the real site, so their results
 * are evidence of how the product behaves" -- asserted of every test on the
 * page, including ones that had never run. A real project was already in that
 * state: four approved tests, no recorded run at all, which is where the
 * product's own "Cover a page" leaves a team before their pipeline reports
 * back. That sentence would have gone to a manager claiming runs that never
 * happened, on the one page that exists to be trusted.
 */
const test = (latestResult: "PASSED" | "FAILED" | null) => ({ latestResult });

describe("what unlinked tests are said to prove", () => {
  it("claims no run when none has run", () => {
    const note = unlinkedTestsNote([test(null), test(null)]);

    expect(note).toContain("none of them has ever run");
    expect(note).toContain("nothing here shows how the product behaves");
    expect(note).not.toContain("have run against the real site");
  });

  it("says so for a single test that never ran", () => {
    // This assertion was first written as "it has ever run", which is what
    // the code said and is not English, let alone true: it reads as a claim
    // that the test did run. A test can agree with a mistake, and this one
    // did, so the wording is asserted here in full.
    expect(unlinkedTestsNote([test(null)])).toBe(
      "This test is approved, and it has never run, so nothing here shows how the product behaves.",
    );
  });

  it("separates the ones that ran from the ones that did not", () => {
    const note = unlinkedTestsNote([test("PASSED"), test(null), test(null)]);

    // The mixed case is the one a loose sentence gets wrong: it is true of
    // some of them and false of the rest, which reads as true of all.
    expect(note).toContain("One of them has run against the real site");
    expect(note).toContain("2 have never run");
    expect(note).toContain("they show only that the team approved them");
  });

  it("claims the run only when every one of them ran", () => {
    const note = unlinkedTestsNote([test("PASSED"), test("FAILED")]);

    expect(note).toContain("have run against the real site");
    expect(note).not.toContain("never run");
  });

  it("never claims these prove agreed intent, however they ran", () => {
    for (const tests of [[test("PASSED")], [test(null)], [test("PASSED"), test(null)]]) {
      const note = unlinkedTestsNote(tests);
      // A failing test and a passing one are both evidence; neither is a
      // statement that anybody agreed the behaviour should be that way.
      if (tests.some((one) => one.latestResult !== null)) {
        expect(note).toMatch(/not linked to an approved requirement|None is linked/);
      }
    }
  });
  it("reads correctly for the three shapes this project's data is in today", () => {
    // Taken from the database on 2026-10-31 rather than invented, because the
    // mixed case is the one that is easy to get wrong and easy to never see.
    const P = test("PASSED");
    const N = test(null);

    // Checkout web app: five approved, two of them run.
    expect(unlinkedTestsNote([P, P, N, N, N])).toBe(
      "These 5 tests are approved. 2 of them have run against the real site, so those results are evidence of " +
        "how the product behaves; 3 have never run, and they show only that the team approved them. None is " +
        "linked to an approved requirement, so none shows that the behaviour is what anyone agreed it should be.",
    );

    // Cover run 49370: four approved, none run. Nothing to share, and the
    // release page keeps the link shut -- but if it ever reaches a reader,
    // it must not claim a run.
    expect(unlinkedTestsNote([N, N, N, N])).toBe(
      "These 4 tests are approved, and none of them has ever run, so nothing here shows how the product behaves.",
    );

    // Northwind Storefront: one approved, never run.
    expect(unlinkedTestsNote([N])).toBe(
      "This test is approved, and it has never run, so nothing here shows how the product behaves.",
    );
  });
});
