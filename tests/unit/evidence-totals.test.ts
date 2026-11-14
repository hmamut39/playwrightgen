import { describe, expect, it } from "vitest";

import { evidenceTotalsDisplay } from "@/lib/services/release-evidence";

/**
 * What the three numbers at the top of shared evidence are about.
 *
 * They counted requirements, always. A project that reached approved, proven
 * tests through "Cover a page" -- the product's own first suggestion, which
 * produces test cases and no requirement -- met "Verified 0, Failing 0, Not
 * verified 0" above a paragraph of negatives, with its one true good fact
 * below all of it under a heading reading "not linked to a requirement".
 *
 * Every sentence on that page was accurate and the page read as empty. The
 * owner met it on 2026-11-08, the first time he shared his own.
 */

const approved = (over: { latestResult?: "PASSED" | "FAILED" | null } = {}) => ({
  id: "t",
  title: "Edit an existing todo",
  status: "APPROVED",
  versionNumber: 1,
  latestResult: "latestResult" in over ? over.latestResult ?? null : "PASSED",
  latestExecutedAt: null,
  latestCommitSha: null,
  approvedBy: null,
  approvedAt: null,
});

const report = (over: Partial<Parameters<typeof evidenceTotalsDisplay>[0]> = {}) =>
  ({
    totals: { verified: 0, failing: 0, unverified: 0, stale: 0 },
    requirements: [],
    unlinkedTests: [],
    ...over,
  }) as Parameters<typeof evidenceTotalsDisplay>[0];

describe("the numbers at the top of shared evidence", () => {
  it("counts the tests when there is no requirement to count", () => {
    const shown = evidenceTotalsDisplay(
      report({
        unlinkedTests: [
          approved(),
          approved(),
          approved({ latestResult: "FAILED" }),
          approved({ latestResult: null }),
        ] as never,
      }),
    );

    expect(shown.subject).toBe("tests");
    expect(shown.tiles.map((tile) => [tile.label, tile.value])).toEqual([
      ["Passed", 2],
      ["Failing", 1],
      // Approving a test records an intention to check something. It does not
      // check it, and a reader has to see how much of the page is intention.
      ["Never run", 1],
    ]);
  });

  it("keeps the requirement figures the moment there is a requirement", () => {
    // The stronger claim wins. Swapping it for a test count would be the same
    // overstatement running the other way.
    const shown = evidenceTotalsDisplay(
      report({
        totals: { verified: 1, failing: 0, unverified: 2, stale: 0 },
        requirements: [{ id: "r" }] as never,
        unlinkedTests: [approved()] as never,
      }),
    );

    expect(shown.subject).toBe("requirements");
    expect(shown.tiles.map((tile) => [tile.label, tile.value])).toEqual([
      ["Verified", 1],
      ["Failing", 0],
      ["Not verified", 2],
    ]);
  });

  it("still says requirements when the project has nothing at all", () => {
    // An empty project is empty. Relabelling its zeros would not make it less
    // so, and "Passed 0" invites the reader to think tests exist and failed.
    const shown = evidenceTotalsDisplay(report());

    expect(shown.subject).toBe("requirements");
    expect(shown.tiles.every((tile) => tile.value === 0)).toBe(true);
  });

  it("names what it counted, so the two claims cannot be confused", () => {
    // "Passed 1" and "Verified 1" are different claims. The subject is what
    // the page and the kept file print above the tiles.
    const asTests = evidenceTotalsDisplay(report({ unlinkedTests: [approved()] as never }));
    const asRequirements = evidenceTotalsDisplay(report({ requirements: [{ id: "r" }] as never }));

    expect(asTests.tiles.map((tile) => tile.label)).not.toEqual(
      asRequirements.tiles.map((tile) => tile.label),
    );
  });
});
