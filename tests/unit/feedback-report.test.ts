import { describe, expect, it } from "vitest";

import { feedbackHeading, neverEmailed } from "@/lib/services/feedback-report";

/**
 * Reading stored feedback back, including whether anybody was ever told.
 *
 * When a notice fails the report is still kept -- losing it would be worse --
 * but nothing recorded the failure, so a report nobody was told about looked
 * exactly like one that had been read. Between the sending address being set
 * and the API key being corrected, every notice failed and all five stored
 * reports were indistinguishable from five that had arrived.
 */
describe("how a stored report reads", () => {
  it("says plainly when nobody was ever told", () => {
    const heading = feedbackHeading({
      at: "2026-11-07T19:31:57.857Z",
      path: "/pricing",
      who: "a signed-out visitor",
      notified: false,
    });

    expect(heading).toContain("NEVER EMAILED");
    expect(heading).toContain("/pricing");
  });

  it("says when it was sent", () => {
    expect(feedbackHeading({ at: "2026-11-22T13:00:00.000Z", notified: true })).toContain("emailed");
  });

  it("does not claim a failure it has no record of", () => {
    /*
     * Reports stored before this was recorded have no flag. Unknown is not
     * false: showing them as never emailed would invent five failures a day
     * after fixing the real ones.
     */
    const heading = feedbackHeading({ at: "2026-11-07T19:31:57.857Z", path: "/pricing" });

    expect(heading).toContain("delivery unrecorded");
    expect(heading).not.toContain("NEVER");
  });

  it("counts only the ones known to have failed", () => {
    const reports = [{ notified: false }, { notified: true }, {}, { notified: false }];

    expect(neverEmailed(reports)).toBe(2);
  });
});
