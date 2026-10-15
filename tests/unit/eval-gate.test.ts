import { describe, expect, it } from "vitest";

import { compareWithBaseline, gateReport } from "@/scripts/eval-gate.mjs";

/**
 * The gate decides whether an eval run may pass, so it is worth more than the
 * runs it judges and is tested without spending a single model call.
 *
 * The rule it enforces is narrow on purpose. This suite holds measurements of
 * things a model does badly -- the live-page generator passing about one run
 * in three, the requirement review inventing a missing criterion on a
 * complete requirement -- and a gate that demanded all green would be
 * satisfied by deleting them.
 */
const run = (cases: Array<{ name: string; status: string; failure?: string }>) => ({
  ranAt: "2026-10-15T22:00:00.000Z",
  score: { passed: cases.filter((entry) => entry.status === "passed").length, total: cases.length },
  cases: cases.map((entry) => ({ file: "review.eval.ts", ...entry })),
});

describe("what an eval run is allowed to be", () => {
  it("fails when a case that was passing stops passing", () => {
    const comparison = compareWithBaseline(
      run([{ name: "quotes the requirement", status: "failed", failure: "AssertionError: nothing quoted\n at x" }]),
      run([{ name: "quotes the requirement", status: "passed" }]),
    );
    const gate = gateReport(comparison);

    expect(comparison.regressions).toHaveLength(1);
    expect(gate.ok).toBe(false);
    expect(gate.lines[0]).toContain("REGRESSED");
    // The first line of the failure, so the reason is in the log rather than
    // one click away in a file nobody opens.
    expect(gate.lines[1]).toContain("nothing quoted");
  });

  it("passes when a case expected to fail still fails", () => {
    // The measurement this suite exists to keep. Demanding green here would
    // be an invitation to delete it.
    const comparison = compareWithBaseline(
      run([{ name: "does not invent problems", status: "failed" }]),
      run([{ name: "does not invent problems", status: "failed" }]),
    );

    expect(compareWithBaseline(run([]), null).regressions).toEqual([]);
    expect(gateReport(comparison).ok).toBe(true);
  });

  it("says when a known-failing case recovers, without demanding it", () => {
    const gate = gateReport(
      compareWithBaseline(
        run([{ name: "does not invent problems", status: "passed" }]),
        run([{ name: "does not invent problems", status: "failed" }]),
      ),
    );

    expect(gate.ok).toBe(true);
    expect(gate.lines.join(" ")).toContain("recovered");
  });

  it("does not let a case nobody has seen before gate anything", () => {
    // A measurement added today is a decision, not a regression.
    const gate = gateReport(
      compareWithBaseline(run([{ name: "a new measurement", status: "failed" }]), run([])),
    );

    expect(gate.ok).toBe(true);
    expect(gate.lines.join(" ")).toContain("new");
  });

  it("fails when a case in the baseline did not run at all", () => {
    // Renaming a case looks exactly like deleting one from here, and a suite
    // that quietly stops running a measurement leaves somebody believing in a
    // check that is not happening.
    const gate = gateReport(
      compareWithBaseline(run([]), run([{ name: "quotes the requirement", status: "passed" }])),
    );

    expect(gate.ok).toBe(false);
    expect(gate.lines.join(" ")).toContain("NOT RUN");
  });

  it("holds across files with the same case name", () => {
    const current = {
      ranAt: "now",
      score: { passed: 1, total: 2 },
      cases: [
        { file: "review.eval.ts", name: "keeps its promise", status: "passed" },
        { file: "live-page.eval.ts", name: "keeps its promise", status: "failed" },
      ],
    };
    const baseline = {
      cases: [
        { file: "review.eval.ts", name: "keeps its promise", status: "passed" },
        { file: "live-page.eval.ts", name: "keeps its promise", status: "passed" },
      ],
    };

    const comparison = compareWithBaseline(current, baseline);
    expect(comparison.regressions.map((entry) => entry.file)).toEqual(["live-page.eval.ts"]);
  });
});
