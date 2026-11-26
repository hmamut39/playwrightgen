import { describe, expect, it } from "vitest";

import { describeLiveRun, readAutomationLiveRun } from "@/lib/services/automation-artifacts";

/**
 * The record of a run that a reviewer reads before approving.
 *
 * It is JSON on the version row, so it has to survive two things: records
 * written before a field existed, and a field written by something other than
 * this code. A reader that trusts the shape would put `undefined` in front of
 * a person, or throw on a version from last month.
 *
 * `notRunLines` was added on 2026-10-17. Every version recorded before then
 * has a count and no lines, and that has to read as "no detail kept" rather
 * than "nothing was skipped" -- which is why its absence is undefined and not
 * an empty list.
 */
describe("the live run kept with a generated version", () => {
  const run = {
    verdict: "partial",
    passed: 7,
    checks: 3,
    failed: 0,
    notRun: 2,
    notRunLines: [
      { line: "await page.route('**/api/orders', r => r.fulfill())", reason: "page.route() is not run in the preview" },
      { line: "await input.fill(process.env.E2E_PASSWORD)", reason: "needs E2E_PASSWORD from your environment" },
    ],
    fixes: 1,
    pageUrl: "https://shop.example.com/cart",
    ranAt: "2026-10-17T12:00:00.000Z",
    receipt: "pwgr1.body.mac",
  };

  it("keeps the lines and their reasons", () => {
    expect(readAutomationLiveRun(run)?.notRunLines).toEqual(run.notRunLines);
  });

  it("reads a version recorded before the lines were kept", () => {
    const { notRunLines, ...older } = run;
    expect(notRunLines).toBeDefined();
    const read = readAutomationLiveRun(older);
    expect(read).toMatchObject({ verdict: "partial", passed: 7, notRun: 2 });
    // Not [], which would say the preview ran everything.
    expect(read?.notRunLines).toBeUndefined();
  });

  it("drops entries that are not lines rather than trusting the column", () => {
    const read = readAutomationLiveRun({
      ...run,
      notRunLines: [{ line: "await page.waitForEvent('download')" }, { reason: "orphan" }, null, "a string", 7],
    });
    expect(read?.notRunLines).toEqual([{ line: "await page.waitForEvent('download')", reason: "" }]);
  });

  it("refuses a record that does not say how the run came out", () => {
    expect(readAutomationLiveRun(null)).toBeNull();
    expect(readAutomationLiveRun({ ...run, verdict: "fine" })).toBeNull();
    expect(readAutomationLiveRun({ ...run, passed: "seven" })).toBeNull();
  });

  it("describes a partial run as partial, in one sentence", () => {
    const read = readAutomationLiveRun(run);
    if (!read) throw new Error("expected a run");
    expect(describeLiveRun(read)).toBe(
      "Ran on https://shop.example.com/cart: 3 checks passed after 1 automatic fix, 2 steps could not run there.",
    );
  });

  it("does not call an older record's operation count a check count", () => {
    // `checks` was added on 2026-11-08. Before it, the only number kept was
    // every operation the run performed -- goto, fill and press included --
    // and this sentence called all of them checks. A version recorded then
    // cannot be told how much it proved, so it is not told.
    const { checks, ...older } = run;
    expect(checks).toBe(3);
    const read = readAutomationLiveRun(older);
    if (!read) throw new Error("expected a run");
    expect(read.checks).toBeUndefined();
    expect(describeLiveRun(read)).toContain("7 steps passed");
  });
});

/**
 * Layout faults kept beside the run, added 2026-11-26.
 *
 * They are read from the page capture at the start of the generation job, not
 * from the proving run, which executes Playwright and never looks at the
 * page's geometry. The field is named for the load it came from because a
 * reviewer deciding whether to approve has a right to know which one
 * established what.
 */
describe("the layout faults kept with a generated version", () => {
  const base = {
    verdict: "passed",
    passed: 5,
    checks: 2,
    failed: 0,
    notRun: 0,
    fixes: 0,
    pageUrl: "https://shop.example.com/cart",
    ranAt: "2026-11-26T12:00:00.000Z",
    receipt: "pwg-receipt-1",
  };

  it("keeps the faults the page had when the version was generated", () => {
    const read = readAutomationLiveRun({
      ...base,
      pageLayoutAtGeneration: [
        { kind: "stylesheet_failed", what: "A stylesheet did not load (/app.css), so the page rendered unstyled." },
      ],
    });

    expect(read?.pageLayoutAtGeneration).toEqual([
      { kind: "stylesheet_failed", what: "A stylesheet did not load (/app.css), so the page rendered unstyled." },
    ]);
  });

  it("leaves a version recorded before the check existed with no answer", () => {
    /*
     * The important one. An empty array here would tell a reviewer the page
     * was checked and found clean, about a version generated weeks before
     * anything looked at the page at all. Absent has to stay absent.
     */
    const read = readAutomationLiveRun(base);

    expect(read?.pageLayoutAtGeneration).toBeUndefined();
    expect(read).not.toHaveProperty("pageLayoutAtGeneration");
  });

  it("distinguishes a page checked and clean from a page never checked", () => {
    const checkedClean = readAutomationLiveRun({ ...base, pageLayoutAtGeneration: [] });
    const neverChecked = readAutomationLiveRun(base);

    expect(checkedClean?.pageLayoutAtGeneration).toEqual([]);
    expect(neverChecked?.pageLayoutAtGeneration).toBeUndefined();
  });

  it("drops an entry that does not carry a sentence to show", () => {
    // This is JSON on a row; it can be written by an older build or edited.
    // An entry with no `what` would render as blank space under a heading
    // that counted it, which reads as the product losing a finding.
    const read = readAutomationLiveRun({
      ...base,
      pageLayoutAtGeneration: [
        { kind: "overlap" },
        null,
        "clipped",
        { kind: "clipped_text", what: "Text is cut off inside button \"Save\": 12px of it cannot be read." },
      ],
    });

    expect(read?.pageLayoutAtGeneration).toHaveLength(1);
    expect(read?.pageLayoutAtGeneration?.[0].kind).toBe("clipped_text");
  });

  it("does not let a layout fault change the verdict", () => {
    // The behaviour was proved. Whether a page that looks wrong should stop a
    // release is a person's decision, and the badge must not pre-empt it.
    const read = readAutomationLiveRun({
      ...base,
      pageLayoutAtGeneration: [{ kind: "overlap", what: "Two controls overlap." }],
    });

    expect(read?.verdict).toBe("passed");
    expect(describeLiveRun(read!)).not.toContain("overlap");
  });
});
