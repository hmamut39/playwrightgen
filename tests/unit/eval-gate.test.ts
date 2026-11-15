import { describe, expect, it } from "vitest";

import { acceptedBaseline, compareWithBaseline, coverageNote, gateReport } from "@/scripts/eval-gate.mjs";

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

  it("fails when a run reports nothing at all", () => {
    // A suite that failed to start leaves somebody believing in checks that
    // are not happening, and it must not pass just because no file ran.
    const gate = gateReport(
      compareWithBaseline(run([]), run([{ name: "quotes the requirement", status: "passed" }])),
    );

    expect(gate.ok).toBe(false);
    expect(gate.lines.join(" ")).toContain("NOTHING RAN");
  });

  it("does not call a file nobody ran a file that stopped running", () => {
    // Running one eval file on purpose is ordinary. A gate that calls every
    // other file "not run" is a false alarm, and a gate that cries wolf is a
    // gate people learn to ignore.
    const current = {
      ranAt: "now",
      score: { passed: 1, total: 1 },
      cases: [{ file: "review.eval.ts", name: "quotes the requirement", status: "passed" }],
    };
    const baseline = {
      cases: [
        { file: "review.eval.ts", name: "quotes the requirement", status: "passed" },
        { file: "live-page.eval.ts", name: "writes a passing test", status: "failed" },
      ],
    };

    const gate = gateReport(compareWithBaseline(current, baseline));
    expect(gate.ok).toBe(true);
    expect(gate.lines.join(" ")).not.toContain("NOT RUN");
  });

  it("still catches a case that vanished from a file that did run", () => {
    const current = {
      ranAt: "now",
      score: { passed: 1, total: 1 },
      cases: [{ file: "review.eval.ts", name: "quotes the requirement", status: "passed" }],
    };
    const baseline = {
      cases: [
        { file: "review.eval.ts", name: "quotes the requirement", status: "passed" },
        { file: "review.eval.ts", name: "refuses an invented quote", status: "passed" },
      ],
    };

    const gate = gateReport(compareWithBaseline(current, baseline));
    expect(gate.ok).toBe(false);
    expect(gate.lines.join(" ")).toContain("refuses an invented quote");
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

/**
 * What accepting a run does to the baseline.
 *
 * `--accept` wrote the run's cases and nothing else. Running one file on
 * purpose is ordinary -- the gate's own confirm step re-runs single files --
 * so accepting after a filtered run replaced a baseline of the whole suite
 * with a baseline of that file. Every other case became one nobody had seen
 * before, and those cannot regress, by design, so they stopped being gated.
 *
 * Found on 2026-11-14: the committed baseline held 12 cases from three files
 * while the suite ran 57 from thirteen. The gate was watching a fifth of what
 * it reported on, and said "no case did worse than the baseline" either way.
 */
describe("moving the baseline", () => {
  const baselineOf = (cases: Array<{ file: string; name: string; status: string }>) => ({ cases });

  it("keeps the cases a filtered run never measured", () => {
    const before = baselineOf([
      { file: "review.eval.ts", name: "a", status: "passed" },
      { file: "other.eval.ts", name: "b", status: "passed" },
      { file: "other.eval.ts", name: "c", status: "failed" },
    ]);
    const moved = acceptedBaseline(run([{ name: "a", status: "failed" }]), before);

    expect(moved.cases).toHaveLength(3);
    expect(moved.updated).toBe(1);
    expect(moved.added).toBe(0);
    expect(moved.untouched).toBe(2);
    // The one that ran moves. The two that did not stay exactly as they were.
    expect(moved.cases.find((entry) => entry.name === "a")?.status).toBe("failed");
    expect(moved.cases.find((entry) => entry.name === "c")?.status).toBe("failed");
  });

  it("adds a case the baseline has never seen", () => {
    const moved = acceptedBaseline(
      run([{ name: "a", status: "passed" }, { name: "new one", status: "failed" }]),
      baselineOf([{ file: "review.eval.ts", name: "a", status: "passed" }]),
    );

    expect(moved.added).toBe(1);
    expect(moved.updated).toBe(1);
    expect(moved.cases.find((entry) => entry.name === "new one")?.status).toBe("failed");
  });

  it("carries no failure text into the baseline", () => {
    // The baseline records what a case is expected to do. One run's error
    // message is not that, and would turn every comparison into a diff of
    // provider prose.
    const moved = acceptedBaseline(
      run([{ name: "a", status: "failed", failure: "Timeout 5000ms exceeded" }]),
      baselineOf([{ file: "review.eval.ts", name: "a", status: "passed" }]),
    );

    expect(Object.keys(moved.cases[0]).sort()).toEqual(["file", "name", "status"]);
  });
});

describe("saying how much of a run the baseline judges", () => {
  it("counts the cases nothing has an opinion about", () => {
    const measured = run([
      { name: "a", status: "passed" },
      { name: "b", status: "passed" },
      { name: "c", status: "passed" },
    ]);
    const comparison = compareWithBaseline(measured, {
      cases: [{ file: "review.eval.ts", name: "a", status: "passed" }],
    });

    expect(coverageNote(comparison, measured)).toContain("2 of 3");
  });

  it("says nothing when the baseline judges all of it", () => {
    // Silence is the right output for a gate that is doing its job; a line
    // printed every run is a line nobody reads on the run that matters.
    const measured = run([{ name: "a", status: "passed" }]);
    const comparison = compareWithBaseline(measured, {
      cases: [{ file: "review.eval.ts", name: "a", status: "passed" }],
    });

    expect(coverageNote(comparison, measured)).toBeNull();
  });
});

/**
 * A weakness the baseline permits has to keep saying so.
 *
 * The gate had four things to say about a case: it regressed, it recovered,
 * nobody had seen it before, or it stopped running. A case the baseline
 * already expected to be failing fell through all four and was printed
 * nowhere. That is how the live-page pair came to be skipped in CI for weeks
 * without one line of output about it, and how four model weaknesses sat in
 * a run whose summary line read "no case did worse than the baseline".
 *
 * It is the product's own fault class, aimed at the product: something is
 * known and not said where the person is standing.
 */
describe("a failure the baseline already permits", () => {
  it("is reported every run, with the reason somebody wrote down", () => {
    const comparison = compareWithBaseline(
      run([{ name: "invents no problems", status: "failed" }]),
      {
        ranAt: "2026-10-15T22:00:00.000Z",
        cases: [
          {
            file: "review.eval.ts",
            name: "invents no problems",
            status: "failed",
            note: "the model quotes text that is not in the requirement",
          },
        ],
      },
    );
    const gate = gateReport(comparison);

    // Not a regression and not a recovery, so the gate still holds.
    expect(comparison.regressions).toHaveLength(0);
    expect(gate.ok).toBe(true);
    // But it is said out loud, with the reason attached.
    expect(comparison.stillFailing).toHaveLength(1);
    expect(gate.lines.join("\n")).toContain("the model quotes text that is not in the requirement");
  });

  it("says so plainly when nobody wrote a reason", () => {
    const comparison = compareWithBaseline(
      run([{ name: "runs on a real page", status: "skipped" }]),
      run([{ name: "runs on a real page", status: "skipped" }]),
    );
    const gate = gateReport(comparison);

    expect(gate.ok).toBe(true);
    expect(gate.lines.join("\n")).toContain("no reason recorded");
  });

  it("stops saying it once the case passes", () => {
    const comparison = compareWithBaseline(
      run([{ name: "invents no problems", status: "passed" }]),
      run([{ name: "invents no problems", status: "failed" }]),
    );

    expect(comparison.stillFailing).toHaveLength(0);
    expect(comparison.recoveries).toHaveLength(1);
  });
});

describe("accepting a run that still has failures in it", () => {
  it("names the failures it is about to permit without a reason", () => {
    const moved = acceptedBaseline(
      run([
        { name: "invents no problems", status: "failed" },
        { name: "quotes the requirement", status: "passed" },
      ]),
      null,
    );

    expect(moved.unexplained.map((entry) => entry.name)).toEqual(["invents no problems"]);
  });

  it("carries a written reason forward so accepting again does not lose it", () => {
    const baseline = {
      ranAt: "2026-10-15T22:00:00.000Z",
      cases: [
        {
          file: "review.eval.ts",
          name: "invents no problems",
          status: "failed",
          note: "the model quotes text that is not in the requirement",
        },
      ],
    };
    const moved = acceptedBaseline(run([{ name: "invents no problems", status: "failed" }]), baseline);

    expect(moved.unexplained).toHaveLength(0);
    expect(moved.cases[0].note).toBe("the model quotes text that is not in the requirement");
  });

  it("drops the reason when the case starts passing, rather than keeping a stale one", () => {
    const baseline = {
      ranAt: "2026-10-15T22:00:00.000Z",
      cases: [
        {
          file: "review.eval.ts",
          name: "invents no problems",
          status: "failed",
          note: "the model quotes text that is not in the requirement",
        },
      ],
    };
    const moved = acceptedBaseline(run([{ name: "invents no problems", status: "passed" }]), baseline);

    expect(moved.cases[0].note).toBeUndefined();
    expect(moved.unexplained).toHaveLength(0);
  });
});
