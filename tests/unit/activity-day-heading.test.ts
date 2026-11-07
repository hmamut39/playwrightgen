import { describe, expect, it } from "vitest";

import { dayLabel } from "@/app/workspace/[orgSlug]/projects/[projectId]/activity/page";

/**
 * The heading over a day's events on the audit trail.
 *
 * Events are bucketed by their UTC date. The heading built midnight UTC from
 * that date and formatted it in the reader's own zone, which lands on the
 * previous evening anywhere west of UTC. A run recorded on Wednesday 28
 * October at 7:10 PM in New York appeared under "Tuesday, October 27", above
 * a timestamp reading 7:10 PM -- on the page that tells the reader this is
 * the record the audit trail is built from.
 *
 * The process timezone is set here rather than assumed, because the bug is
 * invisible in UTC and that is where CI runs.
 */
const inZone = (tz: string, run: () => string) => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = before;
  }
};

describe("the day heading on the activity trail", () => {
  it("names the day it grouped, west of UTC", () => {
    const label = inZone("America/New_York", () => dayLabel("2026-10-28", "2026-11-07", "2026-11-06"));

    expect(label).toContain("October 28");
    expect(label).toContain("Wednesday");
    // The failure this exists for: the previous evening in the reader's zone.
    expect(label).not.toContain("October 27");
  });

  it("names the same day east of UTC", () => {
    const label = inZone("Asia/Tokyo", () => dayLabel("2026-10-28", "2026-11-07", "2026-11-06"));
    expect(label).toContain("October 28");
  });

  it("still says Today and Yesterday for those buckets", () => {
    // Those two read better than a date and are what people scan for; the
    // fix must not cost them.
    expect(dayLabel("2026-11-07", "2026-11-07", "2026-11-06")).toBe("Today");
    expect(dayLabel("2026-11-06", "2026-11-07", "2026-11-06")).toBe("Yesterday");
  });
});
