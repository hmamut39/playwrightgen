import { describe, expect, it } from "vitest";

import { caseHistories, mergedHistory, orderRuns, trendReport } from "@/scripts/eval-trend.mjs";

/**
 * Reading a case's history across runs.
 *
 * The thing being guarded here is not arithmetic. It is the difference
 * between three kinds of movement that look identical in a score:
 *
 * - a case that keeps changing its mind,
 * - a case that was never measured and now is,
 * - a case that was measured and now is not.
 *
 * Flatten them and the report is worse than nothing: the live-page evals
 * skipped for weeks without a remote browser key and then began passing, so
 * a naive reading makes the suite's newest measurement look like its least
 * trustworthy one, and whoever reads that learns to ignore the report.
 */
const run = (
  ranAt: string,
  cases: Array<[string, string]>,
  file = "review.eval.ts",
): { ranAt: string; score: { passed: number; total: number }; cases: Array<{ file: string; name: string; status: string }> } => ({
  ranAt,
  score: {
    passed: cases.filter(([, status]) => status === "passed").length,
    total: cases.length,
  },
  cases: cases.map(([name, status]) => ({ file, name, status })),
});

describe("putting runs in order", () => {
  it("reads oldest first whatever order they arrive in", () => {
    const ordered = orderRuns([
      run("2026-11-16T10:00:00.000Z", [["a", "passed"]]),
      run("2026-10-19T10:00:00.000Z", [["a", "passed"]]),
      run("2026-11-09T10:00:00.000Z", [["a", "passed"]]),
    ]);

    expect(ordered.map((entry) => entry.ranAt.slice(0, 10))).toEqual([
      "2026-10-19",
      "2026-11-09",
      "2026-11-16",
    ]);
  });

  it("counts one measurement once, however many copies of it arrive", () => {
    /*
     * The real reason this exists. A single run reaches the reader as the
     * dated archive, as latest.json beside it, and as both again inside the
     * CI artifact. Four copies of one afternoon would invent three
     * transitions out of nothing, and the case they were invented about would
     * be reported as the flakiest in the suite.
     */
    const once = run("2026-11-16T10:00:00.000Z", [["a", "failed"]]);
    const ordered = orderRuns([once, { ...once }, { ...once }]);

    expect(ordered).toHaveLength(1);
  });

  it("keeps the fuller copy when two share a timestamp", () => {
    const full = run("2026-11-16T10:00:00.000Z", [
      ["a", "passed"],
      ["b", "passed"],
    ]);
    const truncated = run("2026-11-16T10:00:00.000Z", [["a", "passed"]]);

    expect(orderRuns([truncated, full])[0].cases).toHaveLength(2);
    expect(orderRuns([full, truncated])[0].cases).toHaveLength(2);
  });

  it("ignores anything that is not a run", () => {
    // baseline.json lives in the same directory and carries no ranAt. Reading
    // it as a run crashed the gate's reporter once already.
    expect(orderRuns([null, undefined, { cases: [] }, { ranAt: "x" }] as never)).toEqual([]);
  });

  it("drops a run that measured nothing", () => {
    // A suite that failed to start, or was interrupted. It is a real event
    // and it tells a trend nothing; printed, it is a 0/0 in the score column
    // that reads as a collapse.
    const ordered = orderRuns([
      run("2026-11-01T10:00:00.000Z", [["a", "passed"]]),
      run("2026-11-02T10:00:00.000Z", []),
    ]);

    expect(ordered).toHaveLength(1);
  });
});

describe("what a case's history says", () => {
  const history = (statuses: string[]) =>
    caseHistories(
      statuses.map((status, index) =>
        run(`2026-11-0${index + 1}T10:00:00.000Z`, [["one case", status]]),
      ),
    )[0];

  it("counts a change of side between consecutive measurements", () => {
    const entry = history(["passed", "passed", "failed", "passed"]);

    expect(entry.flips).toBe(2);
    expect(entry.measured).toBe(4);
    expect(entry.shape).toBe("..X.");
  });

  it("does not count the start of a measurement as a change of side", () => {
    /*
     * Four runs skipped for want of a remote browser key, then two passes.
     * Nothing changed its mind here: a check that was not happening started
     * happening, which is the opposite of a case going bad.
     */
    const entry = history(["skipped", "skipped", "skipped", "passed", "passed"]);

    expect(entry.flips).toBe(0);
    expect(entry.startedLate).toBe(true);
    expect(entry.stopped).toBe(false);
    expect(entry.shape).toBe("---..");
  });

  it("joins across a gap rather than reading the gap as movement", () => {
    const entry = history(["passed", "skipped", "passed"]);

    expect(entry.flips).toBe(0);
    expect(entry.measured).toBe(2);
  });

  it("says when a case that used to run has stopped", () => {
    const entry = history(["passed", "passed", "skipped"]);

    expect(entry.stopped).toBe(true);
    expect(entry.status).toBe("skipped");
  });

  it("names when each change happened, not only how many there were", () => {
    const entry = history(["passed", "failed"]);

    expect(entry.changes).toEqual([
      { at: "2026-11-02T10:00:00.000Z", to: "failed", sameDay: false, sameCommit: false },
    ]);
  });

  describe("two answers to the same code", () => {
    const onCommit = (
      runs: Array<[string, string, { sha: string; dirty?: boolean } | null]>,
    ) =>
      caseHistories(
        runs.map(([ranAt, status, commit]) => ({
          ...run(ranAt, [["one case", status]]),
          commit,
        })),
      )[0];

    it("counts a disagreement about one clean commit", () => {
      /*
       * The only movement in this whole report that cannot be somebody's
       * commit. Everything else -- a week apart, a day apart -- may be the
       * code changing underneath, and usually is.
       */
      const entry = onCommit([
        ["2026-11-20T10:00:00.000Z", "passed", { sha: "aaa", dirty: false }],
        ["2026-11-20T14:00:00.000Z", "failed", { sha: "aaa", dirty: false }],
      ]);

      expect(entry.sameCommitFlips).toBe(1);
    });

    it("will not count two runs of uncommitted code as the same code", () => {
      // A dirty tree is code that exists nowhere else. Two dirty runs sharing
      // a sha may have been measuring two different things, which is exactly
      // the wrong conclusion to invite.
      const entry = onCommit([
        ["2026-11-20T10:00:00.000Z", "passed", { sha: "aaa", dirty: true }],
        ["2026-11-20T14:00:00.000Z", "failed", { sha: "aaa", dirty: true }],
      ]);

      expect(entry.sameCommitFlips).toBe(0);
      expect(entry.sameDayFlips).toBe(1);
    });

    it("treats a missing commit as unknown rather than as a match", () => {
      const entry = onCommit([
        ["2026-11-20T10:00:00.000Z", "passed", null],
        ["2026-11-20T14:00:00.000Z", "failed", null],
      ]);

      expect(entry.sameCommitFlips).toBe(0);
    });

    it("does not count a disagreement across two different commits", () => {
      const entry = onCommit([
        ["2026-11-20T10:00:00.000Z", "passed", { sha: "aaa", dirty: false }],
        ["2026-11-20T14:00:00.000Z", "failed", { sha: "bbb", dirty: false }],
      ]);

      expect(entry.sameCommitFlips).toBe(0);
    });
  });

  it("separates a disagreement within one day from one between weeks", () => {
    /*
     * The distinction the whole report turns on. On 15 November the suite
     * scored 54/57, then 56/57, then 54/57, with nothing released between
     * them. A case that moves between weekly runs may have been moved by any
     * commit in between, and usually was; a case that moves twice in an
     * afternoon was moved by nothing at all.
     */
    const entry = caseHistories([
      run("2026-11-15T16:07:00.000Z", [["one case", "failed"]]),
      run("2026-11-15T18:09:00.000Z", [["one case", "passed"]]),
      run("2026-11-22T18:09:00.000Z", [["one case", "failed"]]),
    ])[0];

    expect(entry.flips).toBe(2);
    expect(entry.sameDayFlips).toBe(1);
  });

  it("puts a case that argued with itself in one day above one with more changes", () => {
    const histories = caseHistories([
      run("2026-11-01T10:00:00.000Z", [
        ["weekly", "passed"],
        ["within a day", "passed"],
      ]),
      run("2026-11-02T10:00:00.000Z", [
        ["weekly", "failed"],
        ["within a day", "passed"],
      ]),
      run("2026-11-03T10:00:00.000Z", [
        ["weekly", "passed"],
        ["within a day", "passed"],
      ]),
      run("2026-11-04T10:00:00.000Z", [
        ["weekly", "failed"],
        ["within a day", "failed"],
      ]),
      run("2026-11-04T19:00:00.000Z", [["within a day", "passed"]]),
    ]);

    expect(histories[0].name).toBe("within a day");
    expect(histories[0].flips).toBeLessThan(histories[1].flips);
  });

  it("puts the least trustworthy case first", () => {
    const histories = caseHistories([
      run("2026-11-01T10:00:00.000Z", [
        ["steady", "passed"],
        ["restless", "passed"],
      ]),
      run("2026-11-02T10:00:00.000Z", [
        ["steady", "passed"],
        ["restless", "failed"],
      ]),
      run("2026-11-03T10:00:00.000Z", [
        ["steady", "passed"],
        ["restless", "passed"],
      ]),
    ]);

    expect(histories[0].name).toBe("restless");
    expect(histories[0].flips).toBe(2);
    expect(histories[1].flips).toBe(0);
  });

  it("keeps cases of the same name in different files apart", () => {
    const histories = caseHistories([
      run("2026-11-01T10:00:00.000Z", [["same name", "passed"]], "one.eval.ts"),
      run("2026-11-02T10:00:00.000Z", [["same name", "failed"]], "two.eval.ts"),
    ]);

    expect(histories).toHaveLength(2);
    expect(histories.every((entry) => entry.flips === 0)).toBe(true);
  });
});

describe("the report a person reads", () => {
  const text = (runs: Parameters<typeof trendReport>[0]) => trendReport(runs).lines.join("\n");

  it("says there is nothing rather than printing an empty trend", () => {
    expect(text([])).toContain("No eval runs found");
  });

  it("refuses to draw a trend through one run", () => {
    const report = text([run("2026-11-16T10:00:00.000Z", [["a", "failed"]])]);

    expect(report).toContain("One run is not a trend");
  });

  it("prints the score of every run, because the score is the thing being doubted", () => {
    const report = text([
      run("2026-11-01T10:00:00.000Z", [
        ["a", "passed"],
        ["b", "failed"],
      ]),
      run("2026-11-02T10:00:00.000Z", [
        ["a", "passed"],
        ["b", "passed"],
      ]),
    ]);

    expect(report).toContain("1/2");
    expect(report).toContain("2/2");
    expect(report).toContain("2026-11-01 10:00");
  });

  it("warns that a green flipper will be read as a regression next time", () => {
    /*
     * The week this costs somebody. The baseline is blessed on a day the case
     * happens to pass, so the gate expects a pass, and the next failure
     * arrives looking like something a person did.
     */
    const report = text([
      run("2026-11-01T10:00:00.000Z", [["a", "passed"]]),
      run("2026-11-02T10:00:00.000Z", [["a", "failed"]]),
      run("2026-11-03T10:00:00.000Z", [["a", "passed"]]),
    ]);

    expect(report).toContain("changed side");
    expect(report).toContain("passing today");
    expect(report).toContain("regression");
  });

  it("says the warning that applies to most cases once, not once per case", () => {
    /*
     * The first draft printed "passing now, so the baseline will read its
     * next failure as a regression" under all ten flipping cases. Ten copies
     * of one sentence is how a report teaches its reader to skim, and the
     * line underneath them was the one that mattered.
     */
    const report = text([
      run("2026-11-01T10:00:00.000Z", [
        ["a", "failed"],
        ["b", "failed"],
      ]),
      run("2026-11-02T10:00:00.000Z", [
        ["a", "passed"],
        ["b", "passed"],
      ]),
    ]);

    expect(report.split("will read their next failure as a regression")).toHaveLength(2);
    expect(report).toContain("All 2 are passing today");
  });

  it("will not call a case flaky on two measurements", () => {
    const report = text([
      run("2026-11-01T10:00:00.000Z", [["a", "failed"]]),
      run("2026-11-02T10:00:00.000Z", [["a", "passed"]]),
    ]);

    expect(report).toContain("too few to call flaky");
  });

  it("blames the model only where two runs measured the same commit", () => {
    const report = text([
      { ...run("2026-11-20T10:00:00.000Z", [["a", "passed"]]), commit: { sha: "aaa", dirty: false } },
      { ...run("2026-11-20T14:00:00.000Z", [["a", "failed"]]), commit: { sha: "aaa", dirty: false } },
    ] as never);

    expect(report).toContain("1 on the same commit");
    expect(report).toContain("That is the model, not a regression");
  });

  it("refuses to blame the model when the runs never recorded a commit", () => {
    /*
     * The claim this replaced. "Twice in one day, so it cannot be a commit"
     * read well and was false: 15 November held three eval runs and several
     * commits, and nothing in the records said which commit any run
     * measured. Suggestive is all the data supports, so suggestive is all it
     * says.
     */
    const report = text([
      run("2026-11-15T16:00:00.000Z", [["a", "passed"]]),
      run("2026-11-15T18:00:00.000Z", [["a", "failed"]]),
    ]);

    expect(report).toContain("recorded which commit it measured");
    expect(report).toContain("suggestive");
    expect(report).not.toContain("cannot be the work of a commit");
  });

  it("says plainly when the commits are known and none of them disagreed", () => {
    const report = text([
      { ...run("2026-11-18T10:00:00.000Z", [["a", "passed"]]), commit: { sha: "aaa", dirty: false } },
      { ...run("2026-11-19T10:00:00.000Z", [["a", "failed"]]), commit: { sha: "bbb", dirty: false } },
    ] as never);

    expect(report).toContain("No case gave two different answers to the same commit");
  });

  it("works out the score it quotes instead of repeating a number from the day it was written", () => {
    const report = text([
      run("2026-11-01T10:00:00.000Z", [
        ["a", "failed"],
        ["b", "failed"],
      ]),
      run("2026-11-02T10:00:00.000Z", [
        ["a", "passed"],
        ["b", "failed"],
      ]),
      run("2026-11-03T10:00:00.000Z", [
        ["a", "failed"],
        ["b", "failed"],
      ]),
    ]);

    expect(report).toContain("it went 0/2 to 0/2");
  });

  it("says which runs measured the whole suite, so the score column can be read", () => {
    // 3/4 above 51/57 in one column looks like a collapse until you know the
    // first was somebody running a single file on their laptop.
    const report = text([
      { ...run("2026-11-01T10:00:00.000Z", [["a", "passed"]]), origin: "local" },
      {
        ...run("2026-11-02T10:00:00.000Z", [
          ["a", "passed"],
          ["b", "passed"],
        ]),
        origin: "ci",
      },
    ] as never);

    expect(report).toContain("local");
    expect(report).toContain("weekly");
    expect(report).toContain("1 of these ran the whole suite in CI");
  });

  it("says plainly when nothing moved", () => {
    const report = text([
      run("2026-11-01T10:00:00.000Z", [["a", "passed"]]),
      run("2026-11-02T10:00:00.000Z", [["a", "passed"]]),
    ]);

    expect(report).toContain("No case changed side");
    expect(report).not.toContain("flaky");
  });

  it("reports a measurement that started separately from one that moved", () => {
    const report = text([
      run("2026-11-01T10:00:00.000Z", [["late", "skipped"]]),
      run("2026-11-02T10:00:00.000Z", [["late", "passed"]]),
    ]);

    expect(report).toContain("began being measured");
    expect(report).toContain("No case changed side");
  });

  it("shouts about a measurement that stopped", () => {
    const report = text([
      run("2026-11-01T10:00:00.000Z", [["a", "passed"]]),
      run("2026-11-02T10:00:00.000Z", [["a", "skipped"]]),
    ]);

    expect(report).toContain("STOPPED being measured");
  });

  it("admits it cannot tell a fix from a fluke", () => {
    const report = text([
      run("2026-11-01T10:00:00.000Z", [["a", "failed"]]),
      run("2026-11-02T10:00:00.000Z", [["a", "passed"]]),
      run("2026-11-03T10:00:00.000Z", [["a", "failed"]]),
    ]);

    expect(report).toContain("may be a fix");
    expect(report).toContain("the score said none of it");
  });
});

describe("the series that is kept in the repository", () => {
  it("keeps only which side each case came down on", () => {
    /*
     * A failure string carries the absolute path of whichever machine ran
     * it, down to a home directory name, and this file is committed. It is
     * also longer than everything else in the record put together.
     */
    const merged = mergedHistory(null, [
      {
        ranAt: "2026-11-16T10:00:00.000Z",
        score: { passed: 0, total: 1 },
        cases: [
          {
            file: "review.eval.ts",
            name: "a",
            status: "failed",
            failure: "AssertionError at C:/Users/someone/playwrightgen/evals/review.eval.ts:8:15",
          },
        ],
      },
    ]);

    expect(merged.runs[0].cases[0]).toEqual({ file: "review.eval.ts", name: "a", status: "failed" });
    expect(JSON.stringify(merged)).not.toContain("Users");
  });

  it("adds a run once, however many times it is read again", () => {
    const first = mergedHistory(null, [run("2026-11-16T10:00:00.000Z", [["a", "passed"]])]);
    const second = mergedHistory(first, [
      run("2026-11-16T10:00:00.000Z", [["a", "passed"]]),
      run("2026-11-17T10:00:00.000Z", [["a", "passed"]]),
    ]);

    expect(first.added).toBe(1);
    expect(second.added).toBe(1);
    expect(second.kept).toBe(1);
    expect(second.runs).toHaveLength(2);
  });

  it("does not record a run that measured nothing", () => {
    // A suite that failed to start writes an empty run. Recording it would
    // put a 0/0 in the series and make every case look like it stopped.
    const merged = mergedHistory(null, [run("2026-11-16T10:00:00.000Z", [])]);

    expect(merged.runs).toEqual([]);
  });

  it("works out a missing score rather than storing a hole", () => {
    const merged = mergedHistory(null, [
      {
        ranAt: "2026-11-16T10:00:00.000Z",
        cases: [
          { file: "f", name: "a", status: "passed" },
          { file: "f", name: "b", status: "failed" },
        ],
      },
    ]);

    expect(merged.runs[0].score).toEqual({ passed: 1, total: 2 });
  });
});
