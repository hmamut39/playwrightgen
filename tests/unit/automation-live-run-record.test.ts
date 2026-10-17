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
      "Ran on https://shop.example.com/cart: 7 checks passed after 1 automatic fix, 2 steps could not run there.",
    );
  });
});
