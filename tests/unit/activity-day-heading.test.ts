import { describe, expect, it } from "vitest";

import { dayHeading, dayKeyIn, groupByDay } from "@/components/workspace/activity-days";

/**
 * Which day an event on the audit trail is filed under, and what the heading
 * over it says.
 *
 * This has been wrong twice in opposite directions, on the page that tells
 * the reader it is the record the audit trail is built from and that nothing
 * in it can be edited or removed.
 *
 * First the heading. Events were bucketed by UTC date; the heading built
 * midnight UTC from that date and formatted it in the reader's zone, which
 * lands on the previous evening anywhere west of UTC. A run recorded in New
 * York on Wednesday 28 October at 7:10 PM appeared under "Tuesday, October
 * 27", above a timestamp reading 7:10 PM.
 *
 * Then the buckets. Formatting the heading in UTC made it name the day it had
 * grouped -- and left every timestamp beneath it rendering in the reader's
 * zone, so an event in the small hours UTC still sat under a heading its own
 * timestamp disagreed with. That is the case named below, and it is why the
 * grouping had to move to the browser.
 *
 * The process timezone is set here rather than assumed, because every one of
 * these bugs is invisible in UTC and UTC is where CI runs.
 */
const inZone = <T>(tz: string, run: () => T): T => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = before;
  }
};

const entry = (id: string, iso: string) => ({ id, iso, node: null });

describe("which day an event is filed under", () => {
  it("files a late-evening event under the reader's day, not the UTC one", () => {
    // 10:30 PM on 28 October in New York is already the 29th in UTC. The
    // reader's timestamp says "10:30 PM" and their calendar says the 28th, so
    // the heading has to say the 28th too.
    const day = dayKeyIn("2026-10-29T02:30:00.000Z", "America/New_York");

    expect(day).toBe("2026-10-28");
  });

  it("files an early-morning event under the reader's day east of UTC", () => {
    // The same fault mirrored: 8:30 AM on the 29th in Tokyo is still the 28th
    // in UTC.
    expect(dayKeyIn("2026-10-28T23:30:00.000Z", "Asia/Tokyo")).toBe("2026-10-29");
  });

  it("keeps UTC days when that is the zone asked for", () => {
    // What the server renders, and what the first render in the browser must
    // match while hydrating.
    expect(dayKeyIn("2026-10-29T02:30:00.000Z", "UTC")).toBe("2026-10-29");
  });

  it("puts two events either side of UTC midnight under one heading", () => {
    const groups = groupByDay(
      [
        entry("late", "2026-10-29T02:30:00.000Z"),
        entry("earlier", "2026-10-29T00:10:00.000Z"),
        entry("afternoon", "2026-10-28T19:00:00.000Z"),
      ],
      "America/New_York",
    );

    // All three are 28 October for this reader. Grouped by UTC date they were
    // split across two headings, one of them naming tomorrow.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.day).toBe("2026-10-28");
    expect(groups[0]?.entries.map((item) => item.id)).toEqual(["late", "earlier", "afternoon"]);
  });

  it("keeps the order it was given, newest first", () => {
    const groups = groupByDay(
      [entry("newest", "2026-11-07T10:00:00.000Z"), entry("older", "2026-11-06T10:00:00.000Z")],
      "UTC",
    );

    expect(groups.map((group) => group.day)).toEqual(["2026-11-07", "2026-11-06"]);
  });

  it("groups nothing into nothing", () => {
    expect(groupByDay([], "UTC")).toEqual([]);
  });
});

describe("the day heading on the activity trail", () => {
  it("names the day it grouped, west of UTC", () => {
    const label = inZone("America/New_York", () =>
      dayHeading("2026-10-28", "2026-11-07", "2026-11-06"),
    );

    expect(label).toContain("October 28");
    expect(label).toContain("Wednesday");
    expect(label).toContain("2026");
    // The failure this exists for: the previous evening in the reader's zone.
    expect(label).not.toContain("October 27");
  });

  it("names the same day east of UTC", () => {
    const label = inZone("Asia/Tokyo", () => dayHeading("2026-10-28", "2026-11-07", "2026-11-06"));

    expect(label).toContain("October 28");
    expect(label).not.toContain("October 29");
  });

  it("still says Today and Yesterday for those buckets", () => {
    // Those two read better than a date and are what people scan for; the fix
    // must not cost them.
    expect(dayHeading("2026-11-07", "2026-11-07", "2026-11-06")).toBe("Today");
    expect(dayHeading("2026-11-06", "2026-11-07", "2026-11-06")).toBe("Yesterday");
  });

  it("agrees with the bucket it labels, in every zone it was wrong in", () => {
    // The two halves tested together, which is the thing neither test caught
    // on its own: the day an event is filed under, and the words over it.
    for (const zone of ["America/New_York", "Asia/Tokyo", "UTC", "Pacific/Auckland"]) {
      const day = dayKeyIn("2026-10-29T02:30:00.000Z", zone);
      const label = inZone(zone, () => dayHeading(day, "2026-11-07", "2026-11-06"));
      const [, month, date] = day.split("-");
      const monthName = new Date(`2026-${month}-15T12:00:00Z`).toLocaleDateString("en-US", {
        timeZone: "UTC",
        month: "long",
      });

      expect(label, `heading for ${day} in ${zone}`).toContain(monthName);
      expect(label, `heading for ${day} in ${zone}`).toContain(String(Number(date)));
    }
  });
});
